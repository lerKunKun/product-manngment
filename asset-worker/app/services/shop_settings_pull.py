"""
Shop settings pull (CAS-backed, Track AS3).

Aggregates the small handful of "shop-level config" surfaces that are
needed to migrate a store onto a new Shopify shop:

* ``GET /admin/api/{ver}/shop.json`` — base shop record
  (currency, primaryDomain, name, plan, ...)
* ``GET /admin/api/{ver}/locations.json`` — every location (warehouse / pop-up)
* ``GET /admin/api/{ver}/shipping_zones.json`` — shipping zones + rate cards
* GraphQL ``markets`` connection — multi-market / region splits

These are stitched into one ``shop_settings.json`` document and
written through CAS so identical config across stores in the same
tenant dedups. The manifest carries a single entry pointing at that
JSON.

We intentionally use only public Admin endpoints; no scopes are needed
beyond what the existing pull surfaces already require.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.clients.shopify_admin import ShopifyAdminClient, ShopifyAdminError
from app.services.cas_storage import put_or_link
from app.services.manifest_writer import ManifestEntry, write_manifest
from app.services.progress import ProgressEmitter
from app.services.theme_pull import _safe_put_or_link, _safe_write_manifest

logger = logging.getLogger(__name__)


_MARKETS_QUERY = """
{
  markets(first: 50) {
    nodes {
      id
      name
      handle
      enabled
      primary
      regions(first: 50) {
        nodes {
          id
          name
          ... on MarketRegionCountry { code }
        }
      }
      currencySettings {
        baseCurrency { currencyCode }
        localCurrencies
      }
    }
  }
}
"""


def _r2_prefix(tenant_id: int, store_id: int, snapshot_id: int) -> str:
    return f"tenants/{tenant_id}/stores/{store_id}/snapshots/{snapshot_id}/shop_settings/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ShopSettingsPullService:
    """Orchestrates Admin REST + GraphQL + CAS R2 to materialize shop-level config."""

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
        self._emit("started", message="pulling shop_settings")
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

    def _fetch_rest(
        self, admin: ShopifyAdminClient, path: str, key: str
    ) -> Any:
        """REST GET helper. Returns the wrapped value at ``key`` (or empty fallback)."""
        # ShopifyAdminClient._get is private; mirror its behaviour by going
        # through the public surface only — the path is the same shape used
        # by get_themes / get_policies, so we can reuse the underlying client.
        # We re-use the internal _get via getattr to stay consistent (no
        # bespoke transport here).
        getter = getattr(admin, "_get", None)
        if getter is None:
            raise ShopifyAdminError("admin client missing _get; cannot fetch REST")
        data = getter(path)
        return data.get(key) if isinstance(data, dict) else None

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
                logger.warning("shop_settings %s failed: %s", label, exc)
                return default

        shop = _safe("shop", lambda: self._fetch_rest(admin, "/shop.json", "shop"), None)
        locations = _safe(
            "locations",
            lambda: self._fetch_rest(admin, "/locations.json", "locations"),
            [],
        )
        shipping_zones = _safe(
            "shipping_zones",
            lambda: self._fetch_rest(admin, "/shipping_zones.json", "shipping_zones"),
            [],
        )
        markets_data = _safe(
            "markets",
            lambda: admin.graphql(_MARKETS_QUERY),
            {},
        )
        markets_nodes: list = []
        if isinstance(markets_data, dict):
            root = markets_data.get("markets") if isinstance(markets_data, dict) else None
            if isinstance(root, dict):
                nodes = root.get("nodes")
                if isinstance(nodes, list):
                    markets_nodes = nodes

        document = {
            "shop": shop,
            "locations": locations if isinstance(locations, list) else [],
            "shipping_zones": shipping_zones if isinstance(shipping_zones, list) else [],
            "markets": markets_nodes,
            "fetched_at": _now_iso(),
        }
        body = json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")
        cas = put_or_link(self.r2_client, tenant_id, body, "application/json")
        deduped_count = 1 if cas["deduped"] else 0
        entries: list[ManifestEntry] = [
            {
                "relative_path": "shop_settings.json",
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
            "shop_settings pull done shop=%s snapshot=%s bytes=%d errors=%d elapsed=%ss",
            shop_domain,
            snapshot_id,
            total_bytes,
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
            "shop": {
                "id": 1,
                "name": "Dry Run Shop",
                "myshopify_domain": shop_domain,
                "currency": "USD",
                "plan_name": "basic",
            },
            "locations": [
                {"id": 101, "name": "Main Warehouse", "country_code": "US"},
            ],
            "shipping_zones": [
                {
                    "id": 201,
                    "name": "Default Zone",
                    "countries": [{"code": "US"}],
                    "price_based_shipping_rates": [],
                    "weight_based_shipping_rates": [],
                }
            ],
            "markets": [
                {
                    "id": "gid://shopify/Market/1",
                    "name": "United States",
                    "handle": "us",
                    "enabled": True,
                    "primary": True,
                    "regions": {"nodes": [{"id": "gid://shopify/MarketRegion/1", "name": "United States", "code": "US"}]},
                    "currencySettings": {
                        "baseCurrency": {"currencyCode": "USD"},
                        "localCurrencies": False,
                    },
                }
            ],
            "fetched_at": _now_iso(),
        }
        body = json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")
        cas = _safe_put_or_link(self.r2_client, tenant_id, body, "application/json")
        deduped_count = 1 if cas["deduped"] else 0
        entries: list[ManifestEntry] = [
            {
                "relative_path": "shop_settings.json",
                "sha256": cas["sha256"],
                "size": cas["size"],
                "content_type": "application/json",
                "source_url": None,
            }
        ]
        manifest_key = _safe_write_manifest(self.r2_client, prefix, entries)

        logger.info(
            "shop_settings pull DRY-RUN shop=%s snapshot=%s",
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
