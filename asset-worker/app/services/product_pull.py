"""
Product pull orchestration.

Given a snapshot id, a Shopify shop and a ``product_id``, pulls the full
product JSON via Admin REST and downloads every image binary referenced
by ``images[].src`` from Shopify's public CDN. Each artifact is uploaded
to R2 under a deterministic prefix and a manifest.json is written last.

This is the most complex of the W2-AST pulls because of the binary
media download step. Failure of any single image surfaces immediately
(fail-fast) so the snapshot row stays FAILED in DB; orphan keys in R2
from a partial upload are tolerable and reaped by snapshot lifecycle.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from app.clients.shopify_admin import ShopifyAdminClient, download_url
from app.services._dry_run import try_put_object as _try_put_object
from app.services.progress import ProgressEmitter

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
    extension) returns ``"bin"`` so a content-type-driven fallback can
    be used.
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


class ProductPullService:
    """Orchestrates shopify-cli + Admin REST + CDN media + R2 for a single product."""

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
        manifest_key = f"{prefix}manifest.json"
        started_at = _now_iso()
        clock_start = time.perf_counter()

        token = self.shopify_cli.get_token(shop_domain)
        admin = self.admin_factory(shop_domain, token)
        product = admin.get_product(product_id)

        files: list[dict] = []
        total_bytes = 0

        # 1. product.json
        product_bytes = json.dumps(product, ensure_ascii=False, indent=2).encode("utf-8")
        product_key = f"{prefix}product.json"
        self.r2_client.put_object(
            product_key, product_bytes, content_type="application/json"
        )
        files.append(
            {
                "path": "product.json",
                "r2_key": product_key,
                "size": len(product_bytes),
                "content_type": "application/json",
                "sha256": hashlib.sha256(product_bytes).hexdigest(),
            }
        )
        total_bytes += len(product_bytes)

        # 2. images (sorted by position; missing position pushes to end)
        images = product.get("images") or []
        if not isinstance(images, list):
            images = []
        sorted_images = sorted(
            images, key=lambda img: img.get("position") if isinstance(img.get("position"), int) else 10**9
        )

        # +1 for product.json already written above
        total_count = max(len(sorted_images) + 1, 1)
        emitted = 1
        self._emit("file", progress=emitted / total_count, message="product.json")

        for image in sorted_images:
            src = image.get("src")
            position = image.get("position")
            if not isinstance(src, str) or not src:
                continue
            if not isinstance(position, int):
                position = len(files)  # deterministic-ish fallback
            ext = _extract_image_ext(src)
            body, fetched_ct = self.downloader(src)
            content_type = fetched_ct if ext == "bin" else _content_type_for_ext(ext)
            path = f"image-{position}.{ext}"
            r2_key = f"{prefix}{path}"
            self.r2_client.put_object(r2_key, body, content_type=content_type)
            files.append(
                {
                    "path": path,
                    "r2_key": r2_key,
                    "size": len(body),
                    "content_type": content_type,
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "shopify_image_id": image.get("id"),
                    "src": src,
                }
            )
            total_bytes += len(body)
            emitted += 1
            self._emit("file", progress=emitted / total_count, message=path)

        # 3. manifest last
        variants = product.get("variants") or []
        if not isinstance(variants, list):
            variants = []
        image_count = sum(1 for f in files if f["path"] != "product.json")
        manifest = {
            "snapshot_id": snapshot_id,
            "shop_domain": shop_domain,
            "product_id": product.get("id", product_id),
            "product_handle": product.get("handle", ""),
            "product_title": product.get("title", ""),
            "files": files,
            "summary": {
                "file_count": len(files),
                "total_bytes": total_bytes,
                "image_count": image_count,
                "variant_count": len(variants),
            },
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        self.r2_client.put_object(
            manifest_key, manifest_bytes, content_type="application/json"
        )

        completed_at = _now_iso()
        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "product pull done shop=%s snapshot=%s product=%s files=%d bytes=%d elapsed=%ss",
            shop_domain,
            snapshot_id,
            product_id,
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
        manifest_key = f"{prefix}manifest.json"
        started_at = _now_iso()

        # Synthetic product with 2 images. We DO upload to R2 in dry-run so
        # that downstream consumers (e.g. backend SnapshotGenerationService)
        # can fetch product.json by key without 404. R2 errors are swallowed
        # so dry-run still works without R2 configured.
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

        files: list[dict] = []
        total_bytes = 0

        # 1. product.json
        product_bytes = json.dumps(
            synthetic_product, ensure_ascii=False, indent=2
        ).encode("utf-8")
        product_key = f"{prefix}product.json"
        _try_put_object(
            self.r2_client, product_key, product_bytes, "application/json"
        )
        files.append(
            {
                "path": "product.json",
                "r2_key": product_key,
                "size": len(product_bytes),
                "content_type": "application/json",
                "sha256": hashlib.sha256(product_bytes).hexdigest(),
            }
        )
        total_bytes += len(product_bytes)

        # 2. images — deterministic pseudo-binary content per file.
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
            path = f"image-{position}.{ext}"
            r2_key = f"{prefix}{path}"
            content_type = _content_type_for_ext(ext)
            _try_put_object(self.r2_client, r2_key, body, content_type)
            files.append(
                {
                    "path": path,
                    "r2_key": r2_key,
                    "size": len(body),
                    "content_type": content_type,
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "shopify_image_id": 9000 + position,
                    "src": f"https://cdn/dry-run/image-{position}.{ext}",
                }
            )
            total_bytes += len(body)

        # 3. manifest last — mirror the real-path manifest schema so backend
        #    sees a consistent shape.
        image_count = sum(1 for f in files if f["path"] != "product.json")
        manifest = {
            "snapshot_id": snapshot_id,
            "shop_domain": shop_domain,
            "product_id": synthetic_product["id"],
            "product_handle": synthetic_product["handle"],
            "product_title": synthetic_product["title"],
            "files": files,
            "summary": {
                "file_count": len(files),
                "total_bytes": total_bytes,
                "image_count": image_count,
                "variant_count": len(synthetic_product["variants"]),
            },
            "dry_run": True,
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        _try_put_object(
            self.r2_client, manifest_key, manifest_bytes, "application/json"
        )

        logger.info(
            "product pull DRY-RUN shop=%s snapshot=%s synthetic_files=%d",
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


def _content_type_for_ext(ext: str) -> str:
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
        "avif": "image/avif",
    }.get(ext, "application/octet-stream")
