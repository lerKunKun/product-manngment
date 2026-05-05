"""
Collection pull orchestration (CAS-backed, Track AS2).

Combines Shopify's two collection flavours (``custom_collections`` +
``smart_collections``) into a single snapshot. Each collection is
written as ``{type}-{handle}.json`` through CAS, and a top-level
``index.json`` summary lists all collections (titles + ids only —
full product membership lands in W2-AST-04). Both are recorded in the
single manifest at the snapshot prefix.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.clients.shopify_admin import ShopifyAdminClient
from app.services.cas_storage import put_or_link
from app.services.manifest_writer import ManifestEntry, write_manifest
from app.services.progress import ProgressEmitter
from app.services.theme_pull import _safe_put_or_link, _safe_write_manifest

logger = logging.getLogger(__name__)


def _r2_prefix(tenant_id: int, store_id: int, snapshot_id: int) -> str:
    return f"tenants/{tenant_id}/stores/{store_id}/snapshots/{snapshot_id}/collection/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CollectionPullService:
    """Orchestrates shopify-cli + Admin REST + CAS R2 for custom & smart collections."""

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
        started_at = _now_iso()
        clock_start = time.perf_counter()

        token = self.shopify_cli.get_token(shop_domain)
        admin = self.admin_factory(shop_domain, token)

        custom = admin.get_custom_collections()
        smart = admin.get_smart_collections()

        entries: list[ManifestEntry] = []
        index_entries: list[dict] = []
        total_bytes = 0
        deduped_count = 0

        total_count = max(len(custom) + len(smart) + 1, 1)  # +1 for index.json
        emitted = 0
        for kind, collections in (("custom", custom), ("smart", smart)):
            for coll in collections:
                handle = coll.get("handle") or f"coll-{coll.get('id', 'unknown')}"
                relative_path = f"{kind}-{handle}.json"
                body = json.dumps(coll, ensure_ascii=False, indent=2).encode("utf-8")
                cas = put_or_link(
                    self.r2_client, tenant_id, body, "application/json"
                )
                if cas["deduped"]:
                    deduped_count += 1
                entries.append(
                    {
                        "relative_path": relative_path,
                        "sha256": cas["sha256"],
                        "size": cas["size"],
                        "content_type": "application/json",
                        "source_url": None,
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
                total_bytes += cas["size"]
                emitted += 1
                self._emit(
                    "file", progress=emitted / total_count, message=relative_path
                )

        # index.json — lightweight summary (no product enumeration).
        index_bytes = json.dumps(
            {"collections": index_entries}, ensure_ascii=False, indent=2
        ).encode("utf-8")
        index_cas = put_or_link(
            self.r2_client, tenant_id, index_bytes, "application/json"
        )
        if index_cas["deduped"]:
            deduped_count += 1
        entries.append(
            {
                "relative_path": "index.json",
                "sha256": index_cas["sha256"],
                "size": index_cas["size"],
                "content_type": "application/json",
                "source_url": None,
            }
        )
        total_bytes += index_cas["size"]
        emitted += 1
        self._emit("file", progress=emitted / total_count, message="index.json")

        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        manifest_key = write_manifest(self.r2_client, prefix, entries)

        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "collection pull done shop=%s snapshot=%s files=%d deduped=%d bytes=%d elapsed=%ss",
            shop_domain,
            snapshot_id,
            len(entries),
            deduped_count,
            total_bytes,
            elapsed,
        )
        return {
            "snapshot_id": snapshot_id,
            "r2_prefix": prefix,
            "manifest_key": manifest_key,
            "file_count": len(entries),
            "total_bytes": total_bytes,
            "deduped_count": deduped_count,
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
        started_at = _now_iso()

        synthetic = [
            ("custom", "frontpage", "Frontpage"),
            ("smart", "best-sellers", "Best Sellers"),
        ]
        entries: list[ManifestEntry] = []
        total_bytes = 0
        deduped_count = 0
        for i, (kind, handle, title) in enumerate(synthetic):
            body = json.dumps(
                {
                    "dry_run": True,
                    "snapshot_id": snapshot_id,
                    "id": 1000 + i,
                    "handle": handle,
                    "title": title,
                },
                ensure_ascii=False,
                indent=2,
            ).encode("utf-8")
            cas = _safe_put_or_link(
                self.r2_client, tenant_id, body, "application/json"
            )
            if cas["deduped"]:
                deduped_count += 1
            entries.append(
                {
                    "relative_path": f"{kind}-{handle}.json",
                    "sha256": cas["sha256"],
                    "size": cas["size"],
                    "content_type": "application/json",
                    "source_url": None,
                }
            )
            total_bytes += cas["size"]

        # index.json — matches real path
        index_entries = [
            {"type": kind, "handle": handle, "title": title}
            for kind, handle, title in synthetic
        ]
        index_bytes = json.dumps(
            {"dry_run": True, "snapshot_id": snapshot_id, "collections": index_entries},
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8")
        index_cas = _safe_put_or_link(
            self.r2_client, tenant_id, index_bytes, "application/json"
        )
        if index_cas["deduped"]:
            deduped_count += 1
        entries.append(
            {
                "relative_path": "index.json",
                "sha256": index_cas["sha256"],
                "size": index_cas["size"],
                "content_type": "application/json",
                "source_url": None,
            }
        )
        total_bytes += index_cas["size"]

        manifest_key = _safe_write_manifest(self.r2_client, prefix, entries)

        logger.info(
            "collection pull DRY-RUN shop=%s snapshot=%s synthetic=%d",
            shop_domain,
            snapshot_id,
            len(entries),
        )
        return {
            "snapshot_id": snapshot_id,
            "r2_prefix": prefix,
            "manifest_key": manifest_key,
            "file_count": len(entries),
            "total_bytes": total_bytes,
            "deduped_count": deduped_count,
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": True,
        }
