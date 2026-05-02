"""
Policy pull orchestration.

Mirrors :mod:`app.services.theme_pull` for shop policies (privacy /
refund / terms / shipping / ...). Each policy is written as a single
JSON document under the snapshot's R2 prefix and a manifest is uploaded
last.
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
    return f"tenants/{tenant_id}/stores/{store_id}/snapshots/{snapshot_id}/policy/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PolicyPullService:
    """Orchestrates shopify-cli + Admin REST + R2 to materialize shop policies."""

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
        self._emit("started", message="pulling policy")
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
        policies = admin.get_policies()

        files: list[dict] = []
        total_bytes = 0
        total = max(len(policies), 1)
        for idx, policy in enumerate(policies):
            handle = policy.get("handle") or f"policy-{policy.get('id', 'unknown')}"
            body = json.dumps(policy, ensure_ascii=False, indent=2).encode("utf-8")
            r2_key = f"{prefix}{handle}.json"
            self.r2_client.put_object(r2_key, body, content_type="application/json")
            files.append(
                {
                    "path": f"{handle}.json",
                    "r2_key": r2_key,
                    "handle": handle,
                    "title": policy.get("title", ""),
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
            "kind": "policy",
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
            "policy pull done shop=%s snapshot=%s files=%d bytes=%d elapsed=%ss",
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
            ("privacy-policy", "Privacy Policy"),
            ("terms-of-service", "Terms of Service"),
        ]
        files: list[dict] = []
        total_bytes = 0
        for handle, title in synthetic:
            body = json.dumps(
                {
                    "dry_run": True,
                    "snapshot_id": snapshot_id,
                    "handle": handle,
                    "title": title,
                    "body": f"<p>{title}</p>",
                },
                ensure_ascii=False,
                indent=2,
            ).encode("utf-8")
            r2_key = f"{prefix}{handle}.json"
            _try_put_object(self.r2_client, r2_key, body, "application/json")
            files.append(
                {
                    "path": f"{handle}.json",
                    "r2_key": r2_key,
                    "handle": handle,
                    "title": title,
                    "size": len(body),
                    "content_type": "application/json",
                    "sha256": hashlib.sha256(body).hexdigest(),
                }
            )
            total_bytes += len(body)

        manifest = {
            "snapshot_id": snapshot_id,
            "shop_domain": shop_domain,
            "kind": "policy",
            "files": files,
            "summary": {"file_count": len(files), "total_bytes": total_bytes},
            "dry_run": True,
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        _try_put_object(
            self.r2_client, manifest_key, manifest_bytes, "application/json"
        )

        logger.info(
            "policy pull DRY-RUN shop=%s snapshot=%s synthetic=%d",
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
