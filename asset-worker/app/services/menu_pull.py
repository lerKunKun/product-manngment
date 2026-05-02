"""
Menu pull orchestration.

Mirrors :mod:`app.services.theme_pull` for storefront navigation menus.
Menus are fetched via the GraphQL Admin API (REST has no menus endpoint
in modern API versions) and persisted as one JSON document per menu.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.clients.shopify_admin import ShopifyAdminClient
from app.services._dry_run import try_put_object as _try_put_object
from app.services.progress import ProgressEmitter

logger = logging.getLogger(__name__)


def _r2_prefix(tenant_id: int, store_id: int, snapshot_id: int) -> str:
    return f"tenants/{tenant_id}/stores/{store_id}/snapshots/{snapshot_id}/menu/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class MenuPullService:
    """Orchestrates shopify-cli + Admin GraphQL + R2 for navigation menus."""

    def __init__(
        self,
        shopify_cli: Any,
        r2_client: Any,
        admin_factory: Callable[..., ShopifyAdminClient] = ShopifyAdminClient,
        dry_run: bool = False,
        progress: Optional[ProgressEmitter] = None,
    ) -> None:
        self.shopify_cli = shopify_cli
        self.r2_client = r2_client
        self.admin_factory = admin_factory
        self.dry_run = dry_run
        self.progress = progress

    def _emit(self, event: str, **kw) -> None:
        if self.progress is not None:
            self.progress.emit(event, **kw)

    def pull(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        snapshot_id: int,
    ) -> dict:
        self._emit("started", message="pulling menu")
        try:
            if self.dry_run:
                out = self._pull_dry_run(shop_domain, tenant_id, store_id, snapshot_id)
            else:
                out = self._pull_real(shop_domain, tenant_id, store_id, snapshot_id)
        except Exception as exc:  # noqa: BLE001
            self._emit("failed", message=str(exc))
            raise
        self._emit(
            "completed",
            progress=1.0,
            file_count=out.get("file_count", 0),
            total_bytes=out.get("total_bytes", 0),
        )
        return out

    # ----------------------------------------------------------------- modes

    def _pull_real(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        snapshot_id: int,
    ) -> dict:
        prefix = _r2_prefix(tenant_id, store_id, snapshot_id)
        manifest_key = f"{prefix}manifest.json"
        started_at = _now_iso()
        clock_start = time.perf_counter()

        token = self.shopify_cli.get_token(shop_domain)
        admin = self.admin_factory(shop_domain, token)
        menus = admin.get_menus()

        files: list[dict] = []
        total_bytes = 0
        total = max(len(menus), 1)
        for idx, menu in enumerate(menus):
            handle = menu.get("handle") or f"menu-{menu.get('id', 'unknown')}"
            body = json.dumps(menu, ensure_ascii=False, indent=2).encode("utf-8")
            r2_key = f"{prefix}{handle}.json"
            self.r2_client.put_object(r2_key, body, content_type="application/json")
            files.append(
                {
                    "path": f"{handle}.json",
                    "r2_key": r2_key,
                    "handle": handle,
                    "title": menu.get("title", ""),
                    "item_count": len(menu.get("items") or []),
                    "size": len(body),
                    "content_type": "application/json",
                    "sha256": hashlib.sha256(body).hexdigest(),
                }
            )
            total_bytes += len(body)
            self._emit("file", progress=(idx + 1) / total, message=f"{handle}.json")

        manifest = {
            "snapshot_id": snapshot_id,
            "shop_domain": shop_domain,
            "kind": "menu",
            "files": files,
            "summary": {"file_count": len(files), "total_bytes": total_bytes},
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        self.r2_client.put_object(
            manifest_key, manifest_bytes, content_type="application/json"
        )

        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "menu pull done shop=%s snapshot=%s files=%d bytes=%d elapsed=%ss",
            shop_domain,
            snapshot_id,
            len(files),
            total_bytes,
            elapsed,
        )
        return {
            "snapshot_id": snapshot_id,
            "r2_prefix": prefix,
            "manifest_key": manifest_key,
            "file_count": len(files),
            "total_bytes": total_bytes,
            "started_at": started_at,
            "completed_at": _now_iso(),
        }

    def _pull_dry_run(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        snapshot_id: int,
    ) -> dict:
        prefix = _r2_prefix(tenant_id, store_id, snapshot_id)
        manifest_key = f"{prefix}manifest.json"
        started_at = _now_iso()

        fake_menu = {
            "dry_run": True,
            "snapshot_id": snapshot_id,
            "id": "gid://shopify/Menu/1",
            "handle": "main-menu",
            "title": "Main menu",
            "items": [
                {"title": "Home", "url": "/", "type": "FRONTPAGE", "resourceId": None},
                {
                    "title": "Catalog",
                    "url": "/collections/all",
                    "type": "COLLECTION",
                    "resourceId": None,
                },
                {
                    "title": "Contact",
                    "url": "/pages/contact",
                    "type": "PAGE",
                    "resourceId": None,
                },
            ],
        }
        body = json.dumps(fake_menu, ensure_ascii=False, indent=2).encode("utf-8")
        r2_key = f"{prefix}main-menu.json"
        _try_put_object(self.r2_client, r2_key, body, "application/json")
        files = [
            {
                "path": "main-menu.json",
                "r2_key": r2_key,
                "handle": "main-menu",
                "title": "Main menu",
                "item_count": 3,
                "size": len(body),
                "content_type": "application/json",
                "sha256": hashlib.sha256(body).hexdigest(),
            }
        ]

        manifest = {
            "snapshot_id": snapshot_id,
            "shop_domain": shop_domain,
            "kind": "menu",
            "files": files,
            "summary": {"file_count": len(files), "total_bytes": len(body)},
            "dry_run": True,
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        _try_put_object(
            self.r2_client, manifest_key, manifest_bytes, "application/json"
        )

        logger.info(
            "menu pull DRY-RUN shop=%s snapshot=%s synthetic=%d",
            shop_domain,
            snapshot_id,
            len(files),
        )
        return {
            "snapshot_id": snapshot_id,
            "r2_prefix": prefix,
            "manifest_key": manifest_key,
            "file_count": len(files),
            "total_bytes": len(body),
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": True,
        }
