"""
Preview build orchestration.

Given a product payload + dev-store credentials, this service creates an
unpublished theme on the dev store (so the storefront has a sandbox to
preview against) and optionally pushes the product itself, then returns
a preview URL the frontend can open in a new tab.

Failure semantics mirror :mod:`product_push`:

* ``ShopifyCliError`` (no token) → wrapped as :class:`PreviewBuildError`
  with ``shopify CLI:`` prefix; the route layer maps to HTTP 503.
* ``ShopifyAdminError`` mid-mutation → wrapped as :class:`PreviewBuildError`
  with ``theme create failed:`` prefix; route maps to 502.
* Product creation failure on the dev store does NOT abort the preview —
  the theme alone is enough to render a usable preview URL, so we log a
  warning and leave ``shopify_product_id`` as ``None``.
* Dry-run skips Shopify entirely and returns synthetic ids so end-to-end
  UI work never blocks on missing credentials.

Note: backend-side ``preview_theme`` row updates are out of scope for this
service — the backend's ``PreviewController`` is expected to consume the
returned dict and persist accordingly (W3-PV-05).
"""
from __future__ import annotations

import logging
import random
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.clients.shopify_admin import (
    ShopifyAdminClient,
    ShopifyAdminError,
)
from app.clients.shopify_cli import ShopifyCliError

logger = logging.getLogger(__name__)


class PreviewBuildError(Exception):
    """Raised when the preview pipeline fails fatally before producing a URL."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _theme_numeric_id(theme_id: str) -> str:
    """Extract the numeric tail from a theme id (gid or raw).

    ``gid://shopify/OnlineStoreTheme/123456`` → ``"123456"``.
    Plain numeric ids pass through unchanged.
    """
    if not isinstance(theme_id, str):
        return str(theme_id)
    if "/" in theme_id:
        return theme_id.rsplit("/", 1)[-1]
    return theme_id


class PreviewBuildService:
    """Orchestrates dev-store preview-theme creation for a single product."""

    def __init__(
        self,
        shopify_cli: Any,
        admin_factory: Callable[..., ShopifyAdminClient] = ShopifyAdminClient,
        dry_run: bool = False,
    ) -> None:
        self.shopify_cli = shopify_cli
        self.admin_factory = admin_factory
        self.dry_run = dry_run

    # ----------------------------------------------------------------- public

    def build(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        preview_id: int,
        product_payload: dict,
        access_token: Optional[str] = None,
        theme_name_prefix: str = "preview",
    ) -> dict:
        if self.dry_run:
            return self._build_dry_run(
                shop_domain=shop_domain,
                preview_id=preview_id,
                product_payload=product_payload,
            )
        return self._build_real(
            shop_domain=shop_domain,
            tenant_id=tenant_id,
            store_id=store_id,
            preview_id=preview_id,
            product_payload=product_payload,
            access_token=access_token,
            theme_name_prefix=theme_name_prefix or "preview",
        )

    # ------------------------------------------------------------------ modes

    def _build_real(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        preview_id: int,
        product_payload: dict,
        access_token: Optional[str],
        theme_name_prefix: str,
    ) -> dict:
        started_at = _now_iso()
        clock_start = time.perf_counter()

        # 1) Resolve token. custom_app stores supply ``access_token`` directly.
        if access_token:
            token = access_token
        else:
            try:
                token = self.shopify_cli.get_token(shop_domain)
            except ShopifyCliError as exc:
                # Re-raise CLI errors as-is so the route maps to 503.
                raise
            except Exception as exc:  # noqa: BLE001
                raise PreviewBuildError(f"shopify CLI: {exc}") from exc

        admin = self.admin_factory(shop_domain, token)

        # 2) Create unpublished theme.
        theme_label = f"{theme_name_prefix}-product-{product_payload.get('id', preview_id)}"
        try:
            theme = admin.theme_create_unpublished(theme_label)
        except ShopifyAdminError as exc:
            # Wrap so the route surfaces a structured 502 with a clear prefix.
            raise PreviewBuildError(f"theme create failed: {exc}") from exc

        theme_id = theme.get("id")
        if not theme_id:
            raise PreviewBuildError("theme create failed: response missing 'id'")
        numeric = _theme_numeric_id(str(theme_id))

        # 3) Best-effort: also create the product on the dev store so the
        # preview URL surfaces actual storefront content. If this fails we
        # still have a usable theme-scoped preview URL — log and continue.
        product_id: Optional[str] = None
        try:
            payload_for_create = {
                k: v for k, v in product_payload.items() if k != "id"
            }
            created = admin.create_product(payload_for_create)
            shopify_pid = created.get("id")
            product_id = str(shopify_pid) if shopify_pid is not None else None
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[preview] create_product failed (continuing theme-only) shop=%s preview=%s: %s",
                shop_domain,
                preview_id,
                exc,
            )

        # 4) Build URLs. Product-scoped URL only when handle is known.
        preview_url = f"https://{shop_domain}/?preview_theme_id={numeric}"
        handle = product_payload.get("handle")
        product_preview_url = (
            f"https://{shop_domain}/products/{handle}?preview_theme_id={numeric}"
            if isinstance(handle, str) and handle
            else None
        )

        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "[preview] built shop=%s preview=%s theme=%s product=%s elapsed=%ss",
            shop_domain,
            preview_id,
            theme_id,
            product_id,
            elapsed,
        )

        return {
            "preview_id": preview_id,
            "shopify_theme_id": theme_id,
            "preview_url": preview_url,
            "product_preview_url": product_preview_url,
            "shopify_product_id": product_id,
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": False,
        }

    def _build_dry_run(
        self,
        shop_domain: str,
        preview_id: int,
        product_payload: dict,
    ) -> dict:
        started_at = _now_iso()
        numeric = str(random.randint(900000, 9999999))
        theme_id = f"gid://shopify/OnlineStoreTheme/{numeric}"
        preview_url = f"https://{shop_domain}/?preview_theme_id={numeric}"

        handle = product_payload.get("handle") or "preview-product"
        product_preview_url = (
            f"https://{shop_domain}/products/{handle}?preview_theme_id={numeric}"
        )
        synthetic_product_id = str(random.randint(8_800_000_000, 9_899_999_999))

        logger.info(
            "[preview] DRY-RUN shop=%s preview=%s synthetic_theme=%s",
            shop_domain,
            preview_id,
            numeric,
        )

        return {
            "preview_id": preview_id,
            "shopify_theme_id": theme_id,
            "preview_url": preview_url,
            "product_preview_url": product_preview_url,
            "shopify_product_id": synthetic_product_id,
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": True,
        }
