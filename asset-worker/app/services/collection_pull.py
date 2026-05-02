"""
Collection pull orchestration.

Mirrors :mod:`app.services.theme_pull` but combines Shopify's two
collection flavours (``custom_collections`` + ``smart_collections``)
into a single snapshot. Each collection is written as
``{type}-{handle}.json`` and a top-level ``index.json`` summary lists
all collections (titles + ids only — full product membership lands in
W2-AST-04).
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
    return f"tenants/{tenant_id}/stores/{store_id}/snapshots/{snapshot_id}/collection/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CollectionPullService:
    """Orchestrates shopify-cli + Admin REST + R2 for custom & smart collections."""

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
        self._emit("started", message="pulling collection")
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

        custom = admin.get_custom_collections()
        smart = admin.get_smart_collections()

        files: list[dict] = []
        index_entries: list[dict] = []
        total_bytes = 0

        total_count = max(len(custom) + len(smart) + 1, 1)  # +1 for index.json
        emitted = 0
        for kind, collections in (("custom", custom), ("smart", smart)):
            for coll in collections:
                handle = coll.get("handle") or f"coll-{coll.get('id', 'unknown')}"
                path = f"{kind}-{handle}.json"
                body = json.dumps(coll, ensure_ascii=False, indent=2).encode("utf-8")
                r2_key = f"{prefix}{path}"
                self.r2_client.put_object(
                    r2_key, body, content_type="application/json"
                )
                files.append(
                    {
                        "path": path,
                        "r2_key": r2_key,
                        "type": kind,
                        "handle": handle,
                        "title": coll.get("title", ""),
                        "id": coll.get("id"),
                        "size": len(body),
                        "content_type": "application/json",
                        "sha256": hashlib.sha256(body).hexdigest(),
                    }
                )
                index_entries.append(
                    {
                        "type": kind,
                        "id": coll.get("id"),
                        "handle": handle,
                        "title": coll.get("title", ""),
                    }
                )
                total_bytes += len(body)
                emitted += 1
                self._emit(
                    "file", progress=emitted / total_count, message=path
                )

        # index.json — lightweight summary (no product enumeration).
        index_bytes = json.dumps(
            {"collections": index_entries}, ensure_ascii=False, indent=2
        ).encode("utf-8")
        index_key = f"{prefix}index.json"
        self.r2_client.put_object(index_key, index_bytes, content_type="application/json")
        files.append(
            {
                "path": "index.json",
                "r2_key": index_key,
                "type": "index",
                "size": len(index_bytes),
                "content_type": "application/json",
                "sha256": hashlib.sha256(index_bytes).hexdigest(),
            }
        )
        total_bytes += len(index_bytes)
        emitted += 1
        self._emit("file", progress=emitted / total_count, message="index.json")

        manifest = {
            "snapshot_id": snapshot_id,
            "shop_domain": shop_domain,
            "kind": "collection",
            "files": files,
            "summary": {
                "file_count": len(files),
                "total_bytes": total_bytes,
                "custom_count": len(custom),
                "smart_count": len(smart),
            },
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        self.r2_client.put_object(
            manifest_key, manifest_bytes, content_type="application/json"
        )

        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "collection pull done shop=%s snapshot=%s files=%d bytes=%d elapsed=%ss",
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

        synthetic = [
            ("custom", "frontpage", "Frontpage"),
            ("smart", "best-sellers", "Best Sellers"),
        ]
        files: list[dict] = []
        total_bytes = 0
        for kind, handle, title in synthetic:
            body = json.dumps(
                {
                    "dry_run": True,
                    "snapshot_id": snapshot_id,
                    "id": 1000 + len(files),
                    "handle": handle,
                    "title": title,
                },
                ensure_ascii=False,
                indent=2,
            ).encode("utf-8")
            r2_key = f"{prefix}{kind}-{handle}.json"
            _try_put_object(self.r2_client, r2_key, body, "application/json")
            files.append(
                {
                    "path": f"{kind}-{handle}.json",
                    "r2_key": r2_key,
                    "type": kind,
                    "handle": handle,
                    "title": title,
                    "size": len(body),
                    "content_type": "application/json",
                    "sha256": hashlib.sha256(body).hexdigest(),
                }
            )
            total_bytes += len(body)

        # index.json — lightweight summary (matches the real path).
        index_entries = [
            {"type": kind, "handle": handle, "title": title}
            for kind, handle, title in synthetic
        ]
        index_bytes = json.dumps(
            {"dry_run": True, "snapshot_id": snapshot_id, "collections": index_entries},
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8")
        index_key = f"{prefix}index.json"
        _try_put_object(self.r2_client, index_key, index_bytes, "application/json")

        # manifest last
        manifest = {
            "snapshot_id": snapshot_id,
            "shop_domain": shop_domain,
            "kind": "collection",
            "files": files,
            "summary": {
                "file_count": len(files),
                "total_bytes": total_bytes,
                "custom_count": 1,
                "smart_count": 1,
            },
            "dry_run": True,
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        _try_put_object(
            self.r2_client, manifest_key, manifest_bytes, "application/json"
        )

        logger.info(
            "collection pull DRY-RUN shop=%s snapshot=%s synthetic=%d",
            shop_domain,
            snapshot_id,
            len(files),
        )
        return {
            "snapshot_id": snapshot_id,
            "r2_prefix": prefix,
            "manifest_key": manifest_key,
            "file_count": len(files),
            "total_bytes": total_bytes,
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": True,
        }
