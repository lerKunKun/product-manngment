"""
Theme pull orchestration.

Track AS2 — content-addressable layout.

Pulls every asset of a theme (main / published by default, or an
explicit theme_id) and writes the bytes through the CAS layer
(:mod:`app.services.cas_storage`) plus a single ``manifest.json`` per
snapshot (:mod:`app.services.manifest_writer`).

Blob storage uses ``tenants/{tid}/cas/{sha[:2]}/{sha}`` so the same
theme file shared across stores or repeated snapshots only occupies one
R2 slot. The manifest is the only per-snapshot artifact — it maps
``relative_path -> sha256`` so downstream consumers can reconstruct any
file.

Pull-route response keeps every field it had before; ``deduped_count``
is added for observability.
"""
from __future__ import annotations

import base64
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.clients.shopify_admin import ShopifyAdminClient, ShopifyAdminError
from app.services._dry_run import (
    synthetic_json_bytes as _synthetic_json_bytes,
    synthetic_text_bytes as _synthetic_text_bytes,
)
from app.services.cas_storage import put_or_link
from app.services.manifest_writer import ManifestEntry, write_manifest
from app.services.progress import ProgressEmitter

logger = logging.getLogger(__name__)


def _r2_prefix(tenant_id: int, store_id: int, snapshot_id: int) -> str:
    return f"tenants/{tenant_id}/stores/{store_id}/snapshots/{snapshot_id}/theme/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _guess_content_type(asset: dict, key: str) -> str:
    explicit = asset.get("content_type")
    if isinstance(explicit, str) and explicit:
        return explicit
    if key.endswith(".json"):
        return "application/json"
    if key.endswith(".liquid"):
        return "application/x-liquid"
    if key.endswith(".css"):
        return "text/css"
    if key.endswith(".js"):
        return "application/javascript"
    if key.endswith(".svg"):
        return "image/svg+xml"
    return "application/octet-stream"


def _safe_put_or_link(
    r2_client: Any, tenant_id: int, body: bytes, content_type: Optional[str]
) -> dict:
    """``put_or_link`` that swallows R2 errors (used by dry-run paths)."""
    try:
        return put_or_link(r2_client, tenant_id, body, content_type)
    except Exception as exc:  # noqa: BLE001
        import hashlib

        sha = hashlib.sha256(body).hexdigest()
        logger.warning(
            "dry-run CAS upload failed (continuing in-memory only): err=%s",
            exc,
        )
        return {
            "sha256": sha,
            "size": len(body),
            "cas_key": f"tenants/{tenant_id}/cas/{sha[:2]}/{sha}",
            "deduped": False,
            "content_type": content_type,
        }


def _safe_write_manifest(
    r2_client: Any, prefix: str, entries: list[ManifestEntry]
) -> str:
    """``write_manifest`` that swallows R2 errors (used by dry-run paths)."""
    try:
        return write_manifest(r2_client, prefix, entries)
    except Exception as exc:  # noqa: BLE001
        manifest_key = prefix.rstrip("/") + "/manifest.json"
        logger.warning(
            "dry-run manifest upload failed (swallowed): key=%s err=%s",
            manifest_key,
            exc,
        )
        return manifest_key


class ThemePullService:
    """Orchestrates token + Shopify Admin + CAS R2 to materialize a theme snapshot."""

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

    # ----------------------------------------------------------------- public

    def _emit(self, event: str, **kw) -> None:
        if self.progress is not None:
            self.progress.emit(event, **kw)

    def pull(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        snapshot_id: int,
        theme_id: Optional[int] = None,
    ) -> dict:
        self._emit("started", message="pulling theme")
        try:
            if self.dry_run:
                out = self._pull_dry_run(
                    shop_domain=shop_domain,
                    tenant_id=tenant_id,
                    store_id=store_id,
                    snapshot_id=snapshot_id,
                    theme_id=theme_id,
                )
            else:
                out = self._pull_real(
                    shop_domain=shop_domain,
                    tenant_id=tenant_id,
                    store_id=store_id,
                    snapshot_id=snapshot_id,
                    theme_id=theme_id,
                )
        except Exception as exc:  # noqa: BLE001 — emit then re-raise
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
        theme_id: Optional[int],
    ) -> dict:
        prefix = _r2_prefix(tenant_id, store_id, snapshot_id)
        started_at = _now_iso()
        clock_start = time.perf_counter()

        token = self.shopify_cli.get_token(shop_domain)
        admin = self.admin_factory(shop_domain, token)

        # 1. resolve theme — choose ``main`` when caller didn't pin one.
        if theme_id is None:
            themes = admin.get_themes()
            chosen_theme = self._pick_main_theme(themes)
            theme_id = int(chosen_theme["id"])

        # 2. enumerate assets
        assets_meta = admin.get_assets(theme_id)

        # 3. for each, fetch full body, push to CAS, append manifest entry.
        entries: list[ManifestEntry] = []
        total_bytes = 0
        deduped_count = 0
        total = max(len(assets_meta), 1)
        for idx, meta in enumerate(assets_meta):
            key = meta.get("key")
            if not key:
                continue
            full = admin.get_asset(theme_id, key)
            body = self._asset_to_bytes(full)
            content_type = _guess_content_type(full, key)
            cas = put_or_link(self.r2_client, tenant_id, body, content_type)
            if cas["deduped"]:
                deduped_count += 1
            entries.append(
                {
                    "relative_path": key,
                    "sha256": cas["sha256"],
                    "size": cas["size"],
                    "content_type": content_type,
                    "source_url": None,
                }
            )
            total_bytes += cas["size"]
            self._emit("file", progress=(idx + 1) / total, message=key)

        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        manifest_key = write_manifest(self.r2_client, prefix, entries)

        completed_at = _now_iso()
        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "theme pull done shop=%s snapshot=%s files=%d deduped=%d bytes=%d elapsed=%ss",
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
            "completed_at": completed_at,
        }

    def _pull_dry_run(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        snapshot_id: int,
        theme_id: Optional[int],
    ) -> dict:
        prefix = _r2_prefix(tenant_id, store_id, snapshot_id)
        started_at = _now_iso()

        synthetic = [
            (
                "templates/index.json",
                _synthetic_json_bytes(snapshot_id, "templates/index.json"),
                "application/json",
            ),
            (
                "assets/theme.css",
                _synthetic_text_bytes(snapshot_id, "assets/theme.css"),
                "text/css",
            ),
            (
                "config/settings_data.json",
                _synthetic_json_bytes(snapshot_id, "config/settings_data.json"),
                "application/json",
            ),
        ]

        entries: list[ManifestEntry] = []
        total_bytes = 0
        deduped_count = 0
        total = max(len(synthetic) + 1, 1)
        for idx, (path, body, content_type) in enumerate(synthetic):
            cas = _safe_put_or_link(self.r2_client, tenant_id, body, content_type)
            if cas["deduped"]:
                deduped_count += 1
            entries.append(
                {
                    "relative_path": path,
                    "sha256": cas["sha256"],
                    "size": cas["size"],
                    "content_type": content_type,
                    "source_url": None,
                }
            )
            total_bytes += cas["size"]
            self._emit("file", progress=(idx + 1) / total, message=path)

        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        manifest_key = _safe_write_manifest(self.r2_client, prefix, entries)

        completed_at = _now_iso()
        logger.info(
            "theme pull DRY-RUN shop=%s snapshot=%s synthetic_files=%d deduped=%d",
            shop_domain,
            snapshot_id,
            len(entries),
            deduped_count,
        )
        return {
            "snapshot_id": snapshot_id,
            "r2_prefix": prefix,
            "manifest_key": manifest_key,
            "file_count": len(entries),
            "total_bytes": total_bytes,
            "deduped_count": deduped_count,
            "started_at": started_at,
            "completed_at": completed_at,
            "dry_run": True,
        }

    # ----------------------------------------------------------------- helpers

    @staticmethod
    def _pick_main_theme(themes: list[dict]) -> dict:
        for theme in themes:
            if theme.get("role") == "main":
                return theme
        if themes:
            return themes[0]
        raise ShopifyAdminError("shop has no themes")

    @staticmethod
    def _asset_to_bytes(asset: dict) -> bytes:
        attachment = asset.get("attachment")
        if isinstance(attachment, str) and attachment:
            return base64.b64decode(attachment)
        value = asset.get("value")
        if isinstance(value, str):
            return value.encode("utf-8")
        return b""
