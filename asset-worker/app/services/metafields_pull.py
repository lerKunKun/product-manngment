"""
Metafields pull (CAS-backed, Track AS3).

Captures **shop-level** metafields and their definitions:

* GraphQL ``metafieldDefinitions(ownerType: SHOP)`` — the schema rows
  (namespace / key / type / description / validations).
* GraphQL ``shop.metafields`` — the actual instance values currently
  attached to the shop owner.

PRODUCT-level metafields are intentionally **out of scope** for this
first pass — pulling them per-product on a large catalog can run for
hours and we already have the per-product pull surface that can carry
them in a follow-up. See the TODO marker in :meth:`_pull_real`.

Result: one ``metafields_shop.json`` document under the snapshot
prefix, written through CAS for cross-store dedup.
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


_DEFINITIONS_QUERY = """
query metafieldDefinitions($cursor: String) {
  metafieldDefinitions(first: 250, after: $cursor, ownerType: SHOP) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      namespace
      key
      name
      description
      type { name }
      ownerType
      validations { name value type }
    }
  }
}
"""


_SHOP_METAFIELDS_QUERY = """
query shopMetafields($cursor: String) {
  shop {
    metafields(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        namespace
        key
        type
        value
        description
        createdAt
        updatedAt
      }
    }
  }
}
"""


def _r2_prefix(tenant_id: int, store_id: int, snapshot_id: int) -> str:
    return f"tenants/{tenant_id}/stores/{store_id}/snapshots/{snapshot_id}/metafields/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class MetafieldsPullService:
    """Orchestrates Admin GraphQL + CAS R2 to materialize shop-level metafields."""

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
        self._emit("started", message="pulling metafields")
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

    # ----------------------------------------------------------------- helpers

    def _list_definitions(self, admin: ShopifyAdminClient) -> list[dict]:
        nodes: list[dict] = []
        cursor: Optional[str] = None
        for _ in range(40):  # 40 * 250 = 10k definitions ceiling.
            data = admin.graphql(_DEFINITIONS_QUERY, {"cursor": cursor})
            root = data.get("metafieldDefinitions") or {}
            page_nodes = root.get("nodes") or []
            if isinstance(page_nodes, list):
                for node in page_nodes:
                    if isinstance(node, dict):
                        nodes.append(node)
            page_info = root.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                break
            cursor = page_info.get("endCursor")
            if not cursor:
                break
        return nodes

    def _list_shop_metafields(self, admin: ShopifyAdminClient) -> list[dict]:
        nodes: list[dict] = []
        cursor: Optional[str] = None
        for _ in range(40):
            data = admin.graphql(_SHOP_METAFIELDS_QUERY, {"cursor": cursor})
            shop = data.get("shop") or {}
            mf = shop.get("metafields") or {}
            page_nodes = mf.get("nodes") or []
            if isinstance(page_nodes, list):
                for node in page_nodes:
                    if isinstance(node, dict):
                        nodes.append(node)
            page_info = mf.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                break
            cursor = page_info.get("endCursor")
            if not cursor:
                break
        return nodes

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

        errors: list[str] = []

        def _safe(label: str, fn: Callable[[], Any], default: Any) -> Any:
            try:
                return fn()
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{label}: {exc}")
                logger.warning("metafields %s failed: %s", label, exc)
                return default

        definitions = _safe(
            "definitions",
            lambda: self._list_definitions(admin),
            [],
        )
        instances = _safe(
            "shop.metafields",
            lambda: self._list_shop_metafields(admin),
            [],
        )

        # TODO(AS3 follow-up): PRODUCT-level metafields. Per-product GraphQL
        # over 10k+ products can take hours and exceed the worker timeout, so
        # the first pass intentionally ships SHOP-only and lets a later track
        # decide between (a) lazy per-product pull during push, or (b) a
        # bulk operation job. Tracked in 评估文档 §3 R1 / R2.

        document = {
            "owner_type": "SHOP",
            "definitions": definitions,
            "metafields": instances,
            "fetched_at": _now_iso(),
        }
        body = json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")
        cas = put_or_link(self.r2_client, tenant_id, body, "application/json")
        deduped_count = 1 if cas["deduped"] else 0
        entries: list[ManifestEntry] = [
            {
                "relative_path": "metafields_shop.json",
                "sha256": cas["sha256"],
                "size": cas["size"],
                "content_type": "application/json",
                "source_url": None,
            }
        ]
        total_bytes = cas["size"]

        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        manifest_key = write_manifest(self.r2_client, prefix, entries)

        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "metafields pull done shop=%s snapshot=%s defs=%d instances=%d errors=%d elapsed=%ss",
            shop_domain,
            snapshot_id,
            len(definitions) if isinstance(definitions, list) else 0,
            len(instances) if isinstance(instances, list) else 0,
            len(errors),
            elapsed,
        )

        out: dict = {
            "snapshot_id": snapshot_id,
            "r2_prefix": prefix,
            "manifest_key": manifest_key,
            "file_count": len(entries),
            "total_bytes": total_bytes,
            "deduped_count": deduped_count,
            "started_at": started_at,
            "completed_at": _now_iso(),
        }
        if errors:
            out["errors"] = errors
        return out

    def _pull_dry_run(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        snapshot_id: int,
    ) -> dict:
        prefix = _r2_prefix(tenant_id, store_id, snapshot_id)
        started_at = _now_iso()

        document = {
            "dry_run": True,
            "snapshot_id": snapshot_id,
            "owner_type": "SHOP",
            "definitions": [
                {
                    "id": "gid://shopify/MetafieldDefinition/1",
                    "namespace": "custom",
                    "key": "company_motto",
                    "name": "Company motto",
                    "description": None,
                    "type": {"name": "single_line_text_field"},
                    "ownerType": "SHOP",
                    "validations": [],
                }
            ],
            "metafields": [
                {
                    "id": "gid://shopify/Metafield/1001",
                    "namespace": "custom",
                    "key": "company_motto",
                    "type": "single_line_text_field",
                    "value": "Stay weird.",
                    "description": None,
                    "createdAt": _now_iso(),
                    "updatedAt": _now_iso(),
                }
            ],
            "fetched_at": _now_iso(),
        }
        body = json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")
        cas = _safe_put_or_link(self.r2_client, tenant_id, body, "application/json")
        deduped_count = 1 if cas["deduped"] else 0
        entries: list[ManifestEntry] = [
            {
                "relative_path": "metafields_shop.json",
                "sha256": cas["sha256"],
                "size": cas["size"],
                "content_type": "application/json",
                "source_url": None,
            }
        ]
        manifest_key = _safe_write_manifest(self.r2_client, prefix, entries)

        logger.info(
            "metafields pull DRY-RUN shop=%s snapshot=%s",
            shop_domain,
            snapshot_id,
        )
        return {
            "snapshot_id": snapshot_id,
            "r2_prefix": prefix,
            "manifest_key": manifest_key,
            "file_count": len(entries),
            "total_bytes": cas["size"],
            "deduped_count": deduped_count,
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": True,
        }
