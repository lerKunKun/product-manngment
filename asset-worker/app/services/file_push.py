"""
Push files (R2 → Shopify Files via GraphQL ``fileCreate``).

Used by saga step W3-NEW-03 (MEDIA): the backend hands the worker a list
of R2 keys (typically resolved from a base template manifest); the worker
downloads each blob, base64-encodes it, and pushes them to Shopify Files
in one ``fileCreate`` mutation. The result is a list of synthetic-or-real
``{r2Key, shopify_id, url}`` rows the backend persists into the saga ctx.

Failure semantics:

* ``ShopifyAdminError`` (incl. ``userErrors`` from fileCreate) propagates
  → route layer maps to 502.
* R2 download errors propagate as :class:`R2FetchError` (subclass of
  ``ShopifyAdminError``) → route layer maps to 502.
* ``ShopifyCliError`` / ``RuntimeError`` propagate → route maps to 503.
* Dry-run path skips Shopify + R2 entirely and returns synthetic ids so
  end-to-end UI work never blocks on missing creds.
"""
from __future__ import annotations

import base64
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.clients.shopify_admin import ShopifyAdminClient, ShopifyAdminError

logger = logging.getLogger(__name__)


class R2FetchError(ShopifyAdminError):
    """Raised when downloading a media object from R2 fails."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class FilePushService:
    """Orchestrates R2 download + Shopify Files GraphQL upload."""

    def __init__(
        self,
        shopify_cli: Any,
        r2_client: Any,
        admin_factory: Callable[..., ShopifyAdminClient] = ShopifyAdminClient,
        dry_run: bool = False,
    ) -> None:
        self.shopify_cli = shopify_cli
        self.r2_client = r2_client
        self.admin_factory = admin_factory
        self.dry_run = dry_run

    # ----------------------------------------------------------------- public

    def push(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        r2_keys: list[str],
        access_token: Optional[str] = None,
    ) -> dict:
        if self.dry_run:
            return self._push_dry_run(
                shop_domain=shop_domain,
                tenant_id=tenant_id,
                store_id=store_id,
                task_id=task_id,
                r2_keys=r2_keys,
            )
        return self._push_real(
            shop_domain=shop_domain,
            tenant_id=tenant_id,
            store_id=store_id,
            task_id=task_id,
            r2_keys=r2_keys,
            access_token=access_token,
        )

    # ------------------------------------------------------------------ modes

    def _push_real(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        r2_keys: list[str],
        access_token: Optional[str],
    ) -> dict:
        started_at = _now_iso()
        clock_start = time.perf_counter()

        if not r2_keys:
            logger.info("file push noop shop=%s task=%s (no r2_keys)", shop_domain, task_id)
            return {
                "task_id": task_id,
                "files": [],
                "started_at": started_at,
                "completed_at": _now_iso(),
                "dry_run": False,
            }

        if self.r2_client is None:
            raise R2FetchError(
                "FilePushService requires r2_client when r2_keys are provided"
            )

        # Resolve auth.
        if access_token:
            token = access_token
        else:
            token = self.shopify_cli.get_token(shop_domain)

        # Build FileCreateInput list. Shopify expects a base64 data URL or a
        # public URL. We use data URL form so we can push private R2 bytes
        # without staging through a public CDN.
        inputs: list[dict[str, Any]] = []
        for key in r2_keys:
            try:
                body_bytes, content_type = self.r2_client.get_object(key)
            except Exception as exc:  # noqa: BLE001 - convert to ShopifyAdminError subclass
                logger.error("r2 fetch failed for media key %s: %s", key, exc)
                raise R2FetchError(f"r2 fetch failed for {key}: {exc}") from exc
            b64 = base64.b64encode(body_bytes).decode("ascii")
            inputs.append(
                {
                    "originalSource": f"data:{content_type};base64,{b64}",
                    "contentType": "IMAGE",
                }
            )

        admin = self.admin_factory(shop_domain, token)
        created = admin.file_create(inputs)

        files: list[dict[str, Any]] = []
        for idx, key in enumerate(r2_keys):
            entry: dict[str, Any] = {"r2Key": key}
            if idx < len(created):
                c = created[idx] or {}
                entry["shopify_id"] = c.get("id")
                image = c.get("image") or {}
                entry["url"] = image.get("url") or c.get("url")
                if c.get("alt") is not None:
                    entry["alt"] = c.get("alt")
            files.append(entry)

        completed_at = _now_iso()
        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "file push done shop=%s task=%s count=%d elapsed=%ss",
            shop_domain,
            task_id,
            len(files),
            elapsed,
        )
        return {
            "task_id": task_id,
            "files": files,
            "started_at": started_at,
            "completed_at": completed_at,
            "dry_run": False,
        }

    def _push_dry_run(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        r2_keys: list[str],
    ) -> dict:
        started_at = _now_iso()
        files = [
            {
                "r2Key": k,
                "shopify_id": f"gid://shopify/MediaImage/{99000000 + i}",
                "url": f"https://cdn.shopify.com/dry-run/{i}.jpg",
            }
            for i, k in enumerate(r2_keys)
        ]
        logger.info(
            "file push DRY-RUN shop=%s task=%s count=%d",
            shop_domain,
            task_id,
            len(files),
        )
        return {
            "task_id": task_id,
            "files": files,
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": True,
        }
