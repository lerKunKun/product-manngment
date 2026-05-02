"""
Theme pull orchestration.

Given a snapshot id and a Shopify shop, pulls every asset of a theme
(main / published by default, or an explicit theme_id) and writes both
the asset bodies and a manifest.json into R2 under a deterministic
prefix. The worker is stateless w.r.t. the application database; the
backend records snapshot/file rows in response to SSE events emitted in
W2-AST-05 and is fed by the dict returned here.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from app.clients.shopify_admin import ShopifyAdminClient, ShopifyAdminError
from app.services._dry_run import (
    synthetic_json_bytes as _synthetic_json_bytes,
    synthetic_text_bytes as _synthetic_text_bytes,
    try_put_object as _try_put_object_shared,
)
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


class ThemePullService:
    """Orchestrates token + Shopify Admin + R2 to materialize a theme snapshot."""

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
        manifest_key = f"{prefix}manifest.json"
        started_at = _now_iso()
        clock_start = time.perf_counter()

        token = self.shopify_cli.get_token(shop_domain)
        admin = self.admin_factory(shop_domain, token)

        # 1. resolve theme
        chosen_theme: dict
        if theme_id is None:
            themes = admin.get_themes()
            chosen_theme = self._pick_main_theme(themes)
            theme_id = int(chosen_theme["id"])
        else:
            # Best-effort lookup for naming; tolerate absence.
            try:
                themes = admin.get_themes()
                chosen_theme = next(
                    (t for t in themes if int(t.get("id", -1)) == int(theme_id)),
                    {"id": theme_id, "name": "", "role": ""},
                )
            except ShopifyAdminError:
                chosen_theme = {"id": theme_id, "name": "", "role": ""}

        # 2. enumerate assets
        assets_meta = admin.get_assets(theme_id)

        # 3. for each, fetch full body, compute sha256, upload to R2
        manifest_files: list[dict] = []
        total_bytes = 0
        total = max(len(assets_meta), 1)
        for idx, meta in enumerate(assets_meta):
            key = meta.get("key")
            if not key:
                continue
            full = admin.get_asset(theme_id, key)
            body = self._asset_to_bytes(full)
            content_type = _guess_content_type(full, key)
            sha256 = hashlib.sha256(body).hexdigest()
            r2_key = f"{prefix}{key}"
            self.r2_client.put_object(r2_key, body, content_type=content_type)
            manifest_files.append(
                {
                    "path": key,
                    "r2_key": r2_key,
                    "size": len(body),
                    "content_type": content_type,
                    "sha256": sha256,
                }
            )
            total_bytes += len(body)
            self._emit("file", progress=(idx + 1) / total, message=key)

        # 4. manifest last
        manifest = {
            "snapshot_id": snapshot_id,
            "shop_domain": shop_domain,
            "theme_id": theme_id,
            "theme_name": chosen_theme.get("name", ""),
            "theme_role": chosen_theme.get("role", ""),
            "files": manifest_files,
            "summary": {
                "file_count": len(manifest_files),
                "total_bytes": total_bytes,
            },
        }
        import json as _json

        manifest_bytes = _json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        self.r2_client.put_object(
            manifest_key, manifest_bytes, content_type="application/json"
        )

        completed_at = _now_iso()
        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "theme pull done shop=%s snapshot=%s files=%d bytes=%d elapsed=%ss",
            shop_domain,
            snapshot_id,
            len(manifest_files),
            total_bytes,
            elapsed,
        )

        return {
            "snapshot_id": snapshot_id,
            "r2_prefix": prefix,
            "manifest_key": manifest_key,
            "file_count": len(manifest_files),
            "total_bytes": total_bytes,
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
        manifest_key = f"{prefix}manifest.json"
        started_at = _now_iso()

        # Synthetic theme files. In dry-run we still upload to R2 (best-effort)
        # so downstream consumers (e.g. backend SnapshotGenerationService) can
        # actually fetch the bytes when wired against MinIO/R2 in dev.
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

        files: list[dict] = []
        total_bytes = 0
        total = max(len(synthetic) + 1, 1)
        for idx, (path, body, content_type) in enumerate(synthetic):
            r2_key = f"{prefix}{path}"
            _try_put_object_shared(self.r2_client, r2_key, body, content_type)
            files.append(
                {
                    "path": path,
                    "r2_key": r2_key,
                    "size": len(body),
                    "content_type": content_type,
                    "sha256": hashlib.sha256(body).hexdigest(),
                }
            )
            total_bytes += len(body)
            self._emit("file", progress=(idx + 1) / total, message=path)

        manifest = {
            "snapshot_id": snapshot_id,
            "shop_domain": shop_domain,
            "theme_id": theme_id if theme_id is not None else 0,
            "theme_name": "dry-run-theme",
            "theme_role": "main",
            "files": files,
            "summary": {
                "file_count": len(files),
                "total_bytes": total_bytes,
            },
            "dry_run": True,
        }
        import json as _json

        manifest_bytes = _json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        _try_put_object_shared(
            self.r2_client, manifest_key, manifest_bytes, "application/json"
        )

        completed_at = _now_iso()
        logger.info(
            "theme pull DRY-RUN shop=%s snapshot=%s synthetic_files=%d",
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
            # Fall back to first if nothing flagged main (extremely rare on live shops).
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
        # Empty asset (e.g. checksum-only); represent as empty bytes.
        return b""
