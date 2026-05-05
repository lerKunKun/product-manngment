"""
``POST /pull/{kind}`` routes — entrypoints for snapshot pulls.

The worker is the asset-side of the snapshot pipeline; the backend
invokes these (with a snapshot id it has already created) and consumes
the JSON manifest summary the worker returns. Errors map to:

* 503 when CLI / R2 are not configured (``RuntimeError`` /
  ``ShopifyCliError``) AND we're not in dry-run.
* 502 when Shopify Admin returns a non-2xx mid-pull
  (``ShopifyAdminError``).
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.clients.r2 import R2Client
from app.clients.shopify_admin import ShopifyAdminError
from app.clients.shopify_cli import ShopifyCliClient, ShopifyCliError
from app.config import settings
from app.services.collection_pull import CollectionPullService
from app.services.files_pull import FilesPullService
from app.services.menu_pull import MenuPullService
from app.services.metafields_pull import MetafieldsPullService
from app.services.policy_pull import PolicyPullService
from app.services.product_pull import ProductPullService
from app.services.progress import ProgressEmitter
from app.services.shop_settings_pull import ShopSettingsPullService
from app.services.theme_pull import ThemePullService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pull", tags=["pull"])


class BasePullRequest(BaseModel):
    shop_domain: str = Field(..., min_length=1)
    tenant_id: int
    store_id: int
    snapshot_id: int


class PullThemeRequest(BasePullRequest):
    theme_id: Optional[int] = None


class PullProductRequest(BasePullRequest):
    product_id: int = Field(..., gt=0)


# --------------------------------------------------------------------- singletons

_r2_client: Optional[R2Client] = None
_cli_client: Optional[ShopifyCliClient] = None


def _get_r2_client() -> R2Client:
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


def _get_cli_client() -> ShopifyCliClient:
    global _cli_client
    if _cli_client is None:
        _cli_client = ShopifyCliClient()
    return _cli_client


def _build_progress(snapshot_id: int) -> ProgressEmitter:
    """Per-request emitter; no-op if BACKEND_PROGRESS_URL is empty."""
    return ProgressEmitter(
        backend_url=settings.backend_progress_url,
        snapshot_id=snapshot_id,
        internal_token=settings.internal_api_token,
    )


# ------------------------------------------------------------------------ helper


def _map_pull_exception(label: str, exc: Exception) -> HTTPException:
    """Translate a pull-pipeline exception into the standard HTTP shape."""
    if isinstance(exc, ShopifyCliError):
        logger.warning("pull/%s CLI error: %s", label, exc)
        return HTTPException(status_code=503, detail=f"shopify CLI: {exc}")
    if isinstance(exc, ShopifyAdminError):
        logger.error("pull/%s shopify admin error: %s", label, exc)
        return HTTPException(status_code=502, detail=f"shopify admin: {exc}")
    if isinstance(exc, RuntimeError):
        logger.warning("pull/%s runtime error: %s", label, exc)
        return HTTPException(status_code=503, detail=str(exc))
    logger.exception("pull/%s unexpected error", label)
    return HTTPException(status_code=500, detail=f"unexpected: {exc}")


# ------------------------------------------------------------------------ routes


@router.post("/theme")
async def pull_theme(req: PullThemeRequest) -> dict:
    progress = _build_progress(req.snapshot_id)
    svc = ThemePullService(
        shopify_cli=_get_cli_client(),
        r2_client=_get_r2_client(),
        dry_run=settings.worker_dry_run,
        progress=progress,
    )
    try:
        return await run_in_threadpool(
            svc.pull,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.snapshot_id,
            req.theme_id,
        )
    except (ShopifyCliError, ShopifyAdminError, RuntimeError) as exc:
        raise _map_pull_exception("theme", exc) from exc
    finally:
        progress.close()


@router.post("/policy")
async def pull_policy(req: BasePullRequest) -> dict:
    progress = _build_progress(req.snapshot_id)
    svc = PolicyPullService(
        shopify_cli=_get_cli_client(),
        r2_client=_get_r2_client(),
        dry_run=settings.worker_dry_run,
        progress=progress,
    )
    try:
        return await run_in_threadpool(
            svc.pull,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.snapshot_id,
        )
    except (ShopifyCliError, ShopifyAdminError, RuntimeError) as exc:
        raise _map_pull_exception("policy", exc) from exc
    finally:
        progress.close()


@router.post("/menu")
async def pull_menu(req: BasePullRequest) -> dict:
    progress = _build_progress(req.snapshot_id)
    svc = MenuPullService(
        shopify_cli=_get_cli_client(),
        r2_client=_get_r2_client(),
        dry_run=settings.worker_dry_run,
        progress=progress,
    )
    try:
        return await run_in_threadpool(
            svc.pull,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.snapshot_id,
        )
    except (ShopifyCliError, ShopifyAdminError, RuntimeError) as exc:
        raise _map_pull_exception("menu", exc) from exc
    finally:
        progress.close()


@router.post("/collection")
async def pull_collection(req: BasePullRequest) -> dict:
    progress = _build_progress(req.snapshot_id)
    svc = CollectionPullService(
        shopify_cli=_get_cli_client(),
        r2_client=_get_r2_client(),
        dry_run=settings.worker_dry_run,
        progress=progress,
    )
    try:
        return await run_in_threadpool(
            svc.pull,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.snapshot_id,
        )
    except (ShopifyCliError, ShopifyAdminError, RuntimeError) as exc:
        raise _map_pull_exception("collection", exc) from exc
    finally:
        progress.close()


@router.post("/product")
async def pull_product(req: PullProductRequest) -> dict:
    progress = _build_progress(req.snapshot_id)
    svc = ProductPullService(
        shopify_cli=_get_cli_client(),
        r2_client=_get_r2_client(),
        dry_run=settings.worker_dry_run,
        progress=progress,
    )
    try:
        return await run_in_threadpool(
            svc.pull,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.snapshot_id,
            req.product_id,
        )
    except (ShopifyCliError, ShopifyAdminError, RuntimeError) as exc:
        raise _map_pull_exception("product", exc) from exc
    finally:
        progress.close()


# ----------------------------------------------------- Track AS3 endpoints
# Files library / shop settings / shop-level metafields. Request shape is
# identical to the original BasePullRequest contract so the backend's
# SyncConsumer can build them with the same helper.


@router.post("/files")
async def pull_files(req: BasePullRequest) -> dict:
    progress = _build_progress(req.snapshot_id)
    svc = FilesPullService(
        shopify_cli=_get_cli_client(),
        r2_client=_get_r2_client(),
        dry_run=settings.worker_dry_run,
        progress=progress,
    )
    try:
        return await run_in_threadpool(
            svc.pull,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.snapshot_id,
        )
    except (ShopifyCliError, ShopifyAdminError, RuntimeError) as exc:
        raise _map_pull_exception("files", exc) from exc
    finally:
        progress.close()


@router.post("/shop_settings")
async def pull_shop_settings(req: BasePullRequest) -> dict:
    progress = _build_progress(req.snapshot_id)
    svc = ShopSettingsPullService(
        shopify_cli=_get_cli_client(),
        r2_client=_get_r2_client(),
        dry_run=settings.worker_dry_run,
        progress=progress,
    )
    try:
        return await run_in_threadpool(
            svc.pull,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.snapshot_id,
        )
    except (ShopifyCliError, ShopifyAdminError, RuntimeError) as exc:
        raise _map_pull_exception("shop_settings", exc) from exc
    finally:
        progress.close()


@router.post("/metafields")
async def pull_metafields(req: BasePullRequest) -> dict:
    progress = _build_progress(req.snapshot_id)
    svc = MetafieldsPullService(
        shopify_cli=_get_cli_client(),
        r2_client=_get_r2_client(),
        dry_run=settings.worker_dry_run,
        progress=progress,
    )
    try:
        return await run_in_threadpool(
            svc.pull,
            req.shop_domain,
            req.tenant_id,
            req.store_id,
            req.snapshot_id,
        )
    except (ShopifyCliError, ShopifyAdminError, RuntimeError) as exc:
        raise _map_pull_exception("metafields", exc) from exc
    finally:
        progress.close()
