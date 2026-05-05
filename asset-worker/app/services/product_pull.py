"""
Product pull orchestration (CAS-backed, Track AS2).

Pulls the full product JSON via Admin REST and downloads every image
binary referenced by ``images[].src`` from Shopify's CDN. Bytes are
pushed through CAS (:mod:`app.services.cas_storage`) so the same image
shared across stores or repeat snapshots only takes one R2 slot, and a
single ``manifest.json`` at the snapshot prefix maps relative_path ->
sha256.

**Backward-compat note** — :class:`SnapshotGenerationService` (Java)
reads ``{prefix}product.json`` directly to re-derive a snapshot CSV. We
therefore *also* PUT ``product.json`` at that legacy key in the real
path; the same bytes still go through CAS too. The duplicate write is
small (a single JSON document per pull) and avoids a backend change.
The dry-run path mirrors this behaviour so ``downloadBytes`` keeps
working in dev / MinIO. Removing the legacy key is a follow-up that
must land alongside an update to ``SnapshotGenerationService``.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from app.clients.shopify_admin import ShopifyAdminClient, download_url
from app.services._dry_run import try_put_object as _try_put_object
from app.services.cas_storage import put_or_link
from app.services.manifest_writer import ManifestEntry, write_manifest
from app.services.progress import ProgressEmitter
from app.services.theme_pull import _safe_put_or_link, _safe_write_manifest

logger = logging.getLogger(__name__)


_IMAGE_EXT_WHITELIST = frozenset({"jpg", "jpeg", "png", "webp", "gif", "avif"})


def _r2_prefix(tenant_id: int, store_id: int, snapshot_id: int) -> str:
    return f"tenants/{tenant_id}/stores/{store_id}/snapshots/{snapshot_id}/product/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_image_ext(url: str) -> str:
    """Return the lowercased image extension from a CDN URL.

    Strips the query string, lowercases, then returns the trailing
    ``.{ext}`` component if present and whitelisted. ``jpeg`` collapses
    to ``jpg``. Anything not in the whitelist (or a URL with no
    extension) returns ``"bin"``.
    """
    if not url:
        return "bin"
    path = urlsplit(url).path
    dot = path.rfind(".")
    if dot < 0 or dot == len(path) - 1:
        return "bin"
    ext = path[dot + 1 :].lower()
    if ext == "jpeg":
        ext = "jpg"
    if ext in _IMAGE_EXT_WHITELIST:
        return ext
    return "bin"


def _content_type_for_ext(ext: str) -> str:
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
        "avif": "image/avif",
    }.get(ext, "application/octet-stream")


class ProductPullService:
    """Orchestrates shopify-cli + Admin REST + CDN media + CAS R2 for one product."""

    def __init__(
        self,
        shopify_cli: Any,
        r2_client: Any,
        admin_factory: Callable[..., ShopifyAdminClient] = ShopifyAdminClient,
        downloader: Callable[..., tuple[bytes, str]] = download_url,
        dry_run: bool = False,
        progress: Optional[ProgressEmitter] = None,
    ) -> None:
        self.shopify_cli = shopify_cli
        self.r2_client = r2_client
        self.admin_factory = admin_factory
        self.downloader = downloader
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
        product_id: int,
    ) -> dict:
        self._emit("started", message="pulling product")
        try:
            if self.dry_run:
                out = self._pull_dry_run(
                    shop_domain, tenant_id, store_id, snapshot_id, product_id
                )
            else:
                out = self._pull_real(
                    shop_domain, tenant_id, store_id, snapshot_id, product_id
                )
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
        product_id: int,
    ) -> dict:
        prefix = _r2_prefix(tenant_id, store_id, snapshot_id)
        started_at = _now_iso()
        clock_start = time.perf_counter()

        token = self.shopify_cli.get_token(shop_domain)
        admin = self.admin_factory(shop_domain, token)
        product = admin.get_product(product_id)

        entries: list[ManifestEntry] = []
        total_bytes = 0
        deduped_count = 0

        # 1. product.json — push to CAS *and* legacy ``{prefix}product.json``
        #    for SnapshotGenerationService.
        product_bytes = json.dumps(product, ensure_ascii=False, indent=2).encode("utf-8")
        product_cas = put_or_link(
            self.r2_client, tenant_id, product_bytes, "application/json"
        )
        if product_cas["deduped"]:
            deduped_count += 1
        # Legacy key — backend reads this directly. See module docstring.
        legacy_product_key = f"{prefix}product.json"
        self.r2_client.put_object(
            legacy_product_key, product_bytes, content_type="application/json"
        )
        entries.append(
            {
                "relative_path": "product.json",
                "sha256": product_cas["sha256"],
                "size": product_cas["size"],
                "content_type": "application/json",
                "source_url": None,
            }
        )
        total_bytes += product_cas["size"]

        # 2. images (sorted by position; missing position pushes to end)
        images = product.get("images") or []
        if not isinstance(images, list):
            images = []
        sorted_images = sorted(
            images,
            key=lambda img: img.get("position")
            if isinstance(img.get("position"), int)
            else 10**9,
        )

        # +1 for product.json above
        total_count = max(len(sorted_images) + 1, 1)
        emitted = 1
        self._emit("file", progress=emitted / total_count, message="product.json")

        for image in sorted_images:
            src = image.get("src")
            position = image.get("position")
            if not isinstance(src, str) or not src:
                continue
            if not isinstance(position, int):
                position = len(entries)  # deterministic-ish fallback
            ext = _extract_image_ext(src)
            body, fetched_ct = self.downloader(src)
            content_type = (
                fetched_ct if ext == "bin" else _content_type_for_ext(ext)
            )
            cas = put_or_link(self.r2_client, tenant_id, body, content_type)
            if cas["deduped"]:
                deduped_count += 1
            relative_path = f"image-{position}.{ext}"
            entries.append(
                {
                    "relative_path": relative_path,
                    "sha256": cas["sha256"],
                    "size": cas["size"],
                    "content_type": content_type,
                    "source_url": src,
                }
            )
            total_bytes += cas["size"]
            emitted += 1
            self._emit(
                "file", progress=emitted / total_count, message=relative_path
            )

        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        manifest_key = write_manifest(self.r2_client, prefix, entries)

        completed_at = _now_iso()
        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "product pull done shop=%s snapshot=%s product=%s files=%d deduped=%d bytes=%d elapsed=%ss",
            shop_domain,
            snapshot_id,
            product_id,
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
        product_id: int,
    ) -> dict:
        prefix = _r2_prefix(tenant_id, store_id, snapshot_id)
        started_at = _now_iso()

        synthetic_product = {
            "id": product_id or 999,
            "handle": "dry-run-product",
            "title": "Dry Run Product",
            "vendor": "Acme",
            "body_html": "<p>dry run</p>",
            "tags": "dry,run",
            "status": "active",
            "options": [{"name": "Size", "values": ["S", "M"]}],
            "variants": [
                {"id": 1001, "title": "S", "price": "1.00"},
                {"id": 1002, "title": "M", "price": "2.00"},
            ],
            "images": [
                {"id": 9001, "position": 1, "src": "https://cdn/dry-run/image-1.jpg"},
                {"id": 9002, "position": 2, "src": "https://cdn/dry-run/image-2.png"},
            ],
            "dry_run": True,
            "snapshot_id": snapshot_id,
        }

        entries: list[ManifestEntry] = []
        total_bytes = 0
        deduped_count = 0

        # product.json — CAS + legacy key (matches real path)
        product_bytes = json.dumps(
            synthetic_product, ensure_ascii=False, indent=2
        ).encode("utf-8")
        product_cas = _safe_put_or_link(
            self.r2_client, tenant_id, product_bytes, "application/json"
        )
        if product_cas["deduped"]:
            deduped_count += 1
        legacy_product_key = f"{prefix}product.json"
        _try_put_object(
            self.r2_client, legacy_product_key, product_bytes, "application/json"
        )
        entries.append(
            {
                "relative_path": "product.json",
                "sha256": product_cas["sha256"],
                "size": product_cas["size"],
                "content_type": "application/json",
                "source_url": None,
            }
        )
        total_bytes += product_cas["size"]

        # images — deterministic pseudo-binary content per file.
        synthetic_images = [
            (
                1,
                "jpg",
                (
                    b"\xff\xd8\xff\xe0DRY-RUN-JPG\n"
                    + f"snapshot_id={snapshot_id}".encode("utf-8")
                ),
            ),
            (
                2,
                "png",
                (
                    b"\x89PNG\r\n\x1a\nDRY-RUN-PNG\n"
                    + f"snapshot_id={snapshot_id}".encode("utf-8")
                ),
            ),
        ]
        for position, ext, body in synthetic_images:
            content_type = _content_type_for_ext(ext)
            cas = _safe_put_or_link(self.r2_client, tenant_id, body, content_type)
            if cas["deduped"]:
                deduped_count += 1
            entries.append(
                {
                    "relative_path": f"image-{position}.{ext}",
                    "sha256": cas["sha256"],
                    "size": cas["size"],
                    "content_type": content_type,
                    "source_url": f"https://cdn/dry-run/image-{position}.{ext}",
                }
            )
            total_bytes += cas["size"]

        manifest_key = _safe_write_manifest(self.r2_client, prefix, entries)

        logger.info(
            "product pull DRY-RUN shop=%s snapshot=%s synthetic_files=%d",
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
