"""
``POST /preview/build`` route — relay layer for dev-store preview-theme creation.

Given a product payload and dev-store credentials, the worker creates an
unpublished theme on the dev store, optionally pushes the product, and
returns preview URLs the frontend can open to inspect storefront output.

HTTP mapping:

* 200 — success (dry-run or real). ``dry_run`` flag in the body indicates
  which path produced the URL.
* 502 — Shopify Admin returned non-2xx during theme/product create
  (``ShopifyAdminError`` / :class:`PreviewBuildError`).
* 503 — Shopify CLI / config issue (``ShopifyCliError`` / ``RuntimeError``).

NOTE: backend integration (PreviewController triggering this endpoint and
persisting ``preview_theme.shopify_theme_id`` / ``preview_url``) is out of
scope here — wired by W3-PV-05 once the frontend is ready.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.clients.shopify_admin import ShopifyAdminClient, ShopifyAdminError
from app.clients.shopify_cli import ShopifyCliClient, ShopifyCliError
from app.config import settings
from app.services.preview_build import PreviewBuildError, PreviewBuildService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/preview", tags=["preview"])


class PreviewBuildRequest(BaseModel):
    shop_domain: str = Field(..., min_length=1)
    tenant_id: int
    store_id: int
    preview_id: int
    access_token: Optional[str] = None
    product_payload: dict
    theme_name_prefix: Optional[str] = "preview"


# --------------------------------------------------------------------- singletons

_cli_client: Optional[ShopifyCliClient] = None


def _get_cli_client() -> ShopifyCliClient:
    global _cli_client
    if _cli_client is None:
        _cli_client = ShopifyCliClient()
    return _cli_client


# ------------------------------------------------------------------------ routes


@router.post("/build")
async def build_preview(req: PreviewBuildRequest) -> dict:
    svc = PreviewBuildService(
        shopify_cli=_get_cli_client(),
        admin_factory=ShopifyAdminClient,
        dry_run=settings.worker_dry_run,
    )
    try:
        return await run_in_threadpool(
            svc.build,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.preview_id,
            req.product_payload,
            req.access_token,
            req.theme_name_prefix or "preview",
        )
    except ShopifyCliError as exc:
        logger.warning("preview/build CLI error: %s", exc)
        raise HTTPException(status_code=503, detail=f"shopify CLI: {exc}") from exc
    except ShopifyAdminError as exc:
        logger.error("preview/build shopify admin error: %s", exc)
        raise HTTPException(status_code=502, detail=f"shopify admin: {exc}") from exc
    except PreviewBuildError as exc:
        logger.error("preview/build pipeline error: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.warning("preview/build runtime error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
