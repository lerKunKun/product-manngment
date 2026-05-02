"""
``POST /push/product`` route — relay layer for Shopify product create.

The backend builds the full Shopify product payload (handle, options,
variants, images.src) and hands it to the worker. The worker forwards
to Shopify Admin REST and reports the outcome — including
soft-conflicts (handle rename, validation errors) — in a structured
form the backend can persist into ``push_conflict`` and
``store_product``.

HTTP mapping:

* 200 — success or detected handle-rename (``conflict`` may be set).
* 422 — Shopify rejected the payload (validation error). Body carries
  ``conflict={"type":"VALIDATION", ...}`` so the backend doesn't have to
  re-classify by HTTP status alone.
* 502 — Shopify Admin returned non-2xx other than 422.
* 503 — Shopify CLI / config issue (or non-Shopify ``RuntimeError``).
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.clients.r2 import R2Client
from app.clients.shopify_admin import (
    ShopifyAdminClient,
    ShopifyAdminError,
    ShopifyAdminValidationError,
)
from app.clients.shopify_cli import ShopifyCliClient, ShopifyCliError
from app.config import settings
from app.services.collection_push import CollectionPushService
from app.services.file_push import FilePushService
from app.services.product_push import ProductPushService
from app.services.theme_push import ThemePushError, ThemePushService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/push", tags=["push"])


class PushProductRequest(BaseModel):
    shop_domain: str = Field(..., min_length=1)
    tenant_id: int
    store_id: int
    task_id: int
    access_token: Optional[str] = None
    # ``product_payload`` is the raw Shopify ``product`` body. In addition to
    # the standard Shopify fields, the worker honours a non-Shopify extension:
    #   ``media_r2_keys: list[str]`` — R2 keys to download → base64 → append
    #   to ``images[].attachment``. Stripped before posting to Shopify.
    product_payload: dict


class PushFilesRequest(BaseModel):
    """Body for ``POST /push/files`` (saga MEDIA step).

    The worker downloads each ``r2_keys`` blob, base64-encodes it, and
    pushes them to Shopify Files via GraphQL ``fileCreate``. The list may
    be empty — the worker treats that as a no-op success so the saga can
    still advance through MEDIA when a template has no media bindings.
    """

    shop_domain: str = Field(..., min_length=1)
    tenant_id: int
    store_id: int
    task_id: int
    r2_keys: list[str] = Field(default_factory=list)
    access_token: Optional[str] = None


class PushThemeRequest(BaseModel):
    """Body for ``POST /push/theme`` (saga THEME step W3-NEW-06 + W3-NEW-07).

    The worker pulls ``source_zip_r2_key`` from R2, applies optional
    ``replace_rules`` (literal or ``re:`` prefixed regex) to text-like
    files inside the zip, uploads the modified zip back to R2, then asks
    Shopify to install via REST ``themes.json`` with a ``src`` URL.
    Optionally publishes (``role=main``) immediately.
    """

    shop_domain: str = Field(..., min_length=1)
    tenant_id: int
    store_id: int
    task_id: int
    source_zip_r2_key: str = Field(..., min_length=1)
    replace_rules: Optional[dict] = None
    theme_name_prefix: Optional[str] = "saga"
    publish: bool = False
    access_token: Optional[str] = None


class PushCollectionsRequest(BaseModel):
    """Body for ``POST /push/collections`` (saga COLLECTIONS step).

    Each item in ``collections`` is the inner ``custom_collection`` payload
    (handle, title, body_html, sort_order, ...). Per-item failures are
    captured in the response (``error`` field) so the saga can retry only
    the failed entries on retry.
    """

    shop_domain: str = Field(..., min_length=1)
    tenant_id: int
    store_id: int
    task_id: int
    collections: list[dict] = Field(default_factory=list)
    access_token: Optional[str] = None


# --------------------------------------------------------------------- singletons

_cli_client: Optional[ShopifyCliClient] = None
_r2_client: Optional[R2Client] = None


def _get_cli_client() -> ShopifyCliClient:
    global _cli_client
    if _cli_client is None:
        _cli_client = ShopifyCliClient()
    return _cli_client


def _get_r2_client() -> R2Client:
    """Lazy-construct the worker R2 client. Construction never raises;
    missing credentials only surface on the first ``get_object`` call.
    """
    global _r2_client
    if _r2_client is None:
        _r2_client = R2Client(
            endpoint=settings.r2_endpoint,
            access_key=settings.r2_access_key_id,
            secret_key=settings.r2_secret_access_key,
            bucket=settings.r2_bucket,
            region=settings.r2_region,
        )
    return _r2_client


# ------------------------------------------------------------------------ routes


@router.post("/product")
async def push_product(req: PushProductRequest) -> dict:
    svc = ProductPushService(
        shopify_cli=_get_cli_client(),
        admin_factory=ShopifyAdminClient,
        dry_run=settings.worker_dry_run,
        r2_client=_get_r2_client(),
    )
    try:
        result = await run_in_threadpool(
            svc.push,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.task_id,
            req.product_payload,
            req.access_token,
        )
    except ShopifyCliError as exc:
        logger.warning("push/product CLI error: %s", exc)
        raise HTTPException(status_code=503, detail=f"shopify CLI: {exc}") from exc
    except ShopifyAdminValidationError as exc:
        # Defensive: service catches this internally, but keep mapping
        # in case future code paths re-raise.
        logger.warning("push/product validation error escaped service: %s", exc)
        raise HTTPException(
            status_code=422,
            detail={
                "task_id": req.task_id,
                "error": str(exc),
                "conflict": {"type": "VALIDATION", "details": exc.body},
            },
        ) from exc
    except ShopifyAdminError as exc:
        logger.error("push/product shopify admin error: %s", exc)
        raise HTTPException(status_code=502, detail=f"shopify admin: {exc}") from exc
    except RuntimeError as exc:
        logger.warning("push/product runtime error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Service returns a dict for VALIDATION conflicts (not raises) — surface
    # those as HTTP 422 so the backend can branch cleanly on status code.
    conflict = result.get("conflict") or {}
    if conflict.get("type") == "VALIDATION":
        raise HTTPException(status_code=422, detail=result)

    return result


@router.post("/files")
async def push_files(req: PushFilesRequest) -> dict:
    """Push R2-stored media to Shopify Files (saga MEDIA step).

    HTTP mapping mirrors ``/push/product``:
      * 200 — success (incl. dry-run synthetic ids).
      * 502 — Shopify Admin / R2 byte-fetch error.
      * 503 — Shopify CLI / config error.
    """
    svc = FilePushService(
        shopify_cli=_get_cli_client(),
        r2_client=_get_r2_client(),
        admin_factory=ShopifyAdminClient,
        dry_run=settings.worker_dry_run,
    )
    try:
        result = await run_in_threadpool(
            svc.push,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.task_id,
            req.r2_keys,
            req.access_token,
        )
    except ShopifyCliError as exc:
        logger.warning("push/files CLI error: %s", exc)
        raise HTTPException(status_code=503, detail=f"shopify CLI: {exc}") from exc
    except ShopifyAdminError as exc:
        logger.error("push/files shopify admin error: %s", exc)
        raise HTTPException(status_code=502, detail=f"shopify admin: {exc}") from exc
    except RuntimeError as exc:
        logger.warning("push/files runtime error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return result


@router.post("/theme")
async def push_theme(req: PushThemeRequest) -> dict:
    """Install a theme zip on the target store (saga THEME step).

    HTTP mapping:
      * 200 — success (incl. dry-run synthetic ids).
      * 502 — Shopify Admin / R2 byte error.
      * 503 — Shopify CLI / config error.
    """
    svc = ThemePushService(
        shopify_cli=_get_cli_client(),
        r2_client=_get_r2_client(),
        admin_factory=ShopifyAdminClient,
        dry_run=settings.worker_dry_run,
    )
    try:
        result = await run_in_threadpool(
            svc.push,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.task_id,
            req.source_zip_r2_key,
            req.replace_rules,
            req.theme_name_prefix or "saga",
            req.publish,
            req.access_token,
        )
    except ShopifyCliError as exc:
        logger.warning("push/theme CLI error: %s", exc)
        raise HTTPException(status_code=503, detail=f"shopify CLI: {exc}") from exc
    except ThemePushError as exc:
        logger.error("push/theme error: %s", exc)
        # CLI / config-style failures arrive prefixed with ``shopify CLI:``;
        # everything else is treated as upstream byte/admin failure.
        if str(exc).startswith("shopify CLI:"):
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ShopifyAdminError as exc:
        logger.error("push/theme shopify admin error: %s", exc)
        raise HTTPException(status_code=502, detail=f"shopify admin: {exc}") from exc
    except RuntimeError as exc:
        logger.warning("push/theme runtime error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return result


@router.post("/collections")
async def push_collections(req: PushCollectionsRequest) -> dict:
    """Push custom collections to Shopify (saga COLLECTIONS step).

    Per-item failures are captured inline in the response (``error`` per
    entry); the route only raises 503 for CLI / config issues that prevent
    any work from happening.
    """
    svc = CollectionPushService(
        shopify_cli=_get_cli_client(),
        admin_factory=ShopifyAdminClient,
        dry_run=settings.worker_dry_run,
    )
    try:
        result = await run_in_threadpool(
            svc.push,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.task_id,
            req.collections,
            req.access_token,
        )
    except ShopifyCliError as exc:
        logger.warning("push/collections CLI error: %s", exc)
        raise HTTPException(status_code=503, detail=f"shopify CLI: {exc}") from exc
    except RuntimeError as exc:
        logger.warning("push/collections runtime error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return result
