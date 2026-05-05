"""
Shopify Files library pull (CAS-backed, Track AS3).

Pulls every file in the shop's Files library (``GenericFile``,
``MediaImage``, ``Video``) via the Admin GraphQL ``files`` connection,
downloads each file's binary from its CDN URL, runs the bytes through
the CAS layer (:mod:`app.services.cas_storage`), and writes a single
``manifest.json`` per snapshot listing every relative_path -> sha256
mapping (:mod:`app.services.manifest_writer`).

Notes
-----

* Pagination uses GraphQL relay-style cursors at page size 250 (Shopify
  Admin maximum). Page-loop terminates on ``hasNextPage=false``.
* Binary URLs come from ``GenericFile.url`` / ``MediaImage.image.url`` /
  ``Video.sources[].url``. Files that haven't finished processing on
  Shopify's side (no URL yet) are silently skipped — same as theme assets
  with no body.
* Fields used: ``id``, ``alt``, ``createdAt``, ``fileStatus``,
  ``mediaContentType`` plus the type-specific URL/preview blobs.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from app.clients.shopify_admin import ShopifyAdminClient, download_url
from app.services.cas_storage import put_or_link
from app.services.manifest_writer import ManifestEntry, write_manifest
from app.services.progress import ProgressEmitter
from app.services.theme_pull import _safe_put_or_link, _safe_write_manifest

logger = logging.getLogger(__name__)


# Shopify Admin GraphQL: paginate the Files library and return the URL
# we can fetch the binary from for each file type. Page size 250 is the
# Admin maximum.
_FILES_QUERY = """
query files($cursor: String) {
  files(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      cursor
      node {
        id
        alt
        createdAt
        fileStatus
        ... on GenericFile {
          url
          mimeType
          originalFileSize
        }
        ... on MediaImage {
          mediaContentType
          image { url width height }
          originalSource { fileSize url mimeType }
          preview { image { url } }
        }
        ... on Video {
          mediaContentType
          originalSource { url mimeType fileSize }
          preview { image { url } }
        }
      }
    }
  }
}
"""


def _r2_prefix(tenant_id: int, store_id: int, snapshot_id: int) -> str:
    return f"tenants/{tenant_id}/stores/{store_id}/snapshots/{snapshot_id}/files/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _gid_tail(gid: Any) -> str:
    """Extract the numeric/string tail from a Shopify GID, fallback to a stable string."""
    if not isinstance(gid, str) or not gid:
        return "unknown"
    if "/" in gid:
        return gid.rsplit("/", 1)[-1]
    return gid


def _ext_from_url(url: str) -> str:
    """Best-effort extension extraction (lowercased, no dot). Returns empty string when absent."""
    if not isinstance(url, str) or not url:
        return ""
    path = urlsplit(url).path
    dot = path.rfind(".")
    if dot < 0 or dot == len(path) - 1:
        return ""
    ext = path[dot + 1 :].lower()
    if ext == "jpeg":
        ext = "jpg"
    # Sanitize: only allow short alphanumerics.
    if 1 <= len(ext) <= 6 and ext.isalnum():
        return ext
    return ""


def _pick_download(node: dict) -> tuple[Optional[str], Optional[str]]:
    """Return ``(download_url, content_type_hint)`` for a file node, or ``(None, None)``.

    Order of preference, mirroring the GraphQL response shapes:

    1. ``GenericFile.url`` (any non-image / non-video file)
    2. ``MediaImage.image.url`` (the rendered image URL)
    3. ``MediaImage.originalSource.url``
    4. ``Video.originalSource.url``
    """
    url: Optional[str] = None
    ct: Optional[str] = None

    # GenericFile
    if isinstance(node.get("url"), str) and node["url"]:
        url = node["url"]
        ct = node.get("mimeType")
        if isinstance(ct, str) and ct:
            return url, ct
        return url, None

    # MediaImage.image.url
    image = node.get("image")
    if isinstance(image, dict) and isinstance(image.get("url"), str) and image["url"]:
        url = image["url"]

    # Fall back to originalSource for image/video where image.url isn't populated.
    original = node.get("originalSource")
    if isinstance(original, dict):
        if not url and isinstance(original.get("url"), str) and original["url"]:
            url = original["url"]
        ct_orig = original.get("mimeType")
        if isinstance(ct_orig, str) and ct_orig:
            ct = ct_orig

    return url, ct


class FilesPullService:
    """Orchestrates shopify-cli + Admin GraphQL ``files`` + CAS R2 for the Files library."""

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
        self._emit("started", message="pulling files")
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

    def _list_all_files(self, admin: ShopifyAdminClient) -> list[dict]:
        """Walk the full Shopify Files connection via cursor pagination."""
        nodes: list[dict] = []
        cursor: Optional[str] = None
        # Cap iterations as a defensive bound — 200 pages * 250 = 50k files.
        for _ in range(200):
            data = admin.graphql(_FILES_QUERY, {"cursor": cursor})
            files_root = data.get("files") or {}
            edges = files_root.get("edges") or []
            for edge in edges:
                node = edge.get("node") if isinstance(edge, dict) else None
                if isinstance(node, dict):
                    nodes.append(node)
            page_info = files_root.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                break
            cursor = page_info.get("endCursor")
            if not cursor:
                break
        return nodes

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
        nodes = self._list_all_files(admin)

        entries: list[ManifestEntry] = []
        total_bytes = 0
        deduped_count = 0
        errors: list[str] = []
        total = max(len(nodes), 1)

        for idx, node in enumerate(nodes):
            gid = node.get("id")
            tail = _gid_tail(gid)
            url, ct = _pick_download(node)
            if not url:
                # File still processing on Shopify side or unsupported type.
                logger.debug(
                    "files pull skip no-url id=%s status=%s",
                    gid,
                    node.get("fileStatus"),
                )
                self._emit("file", progress=(idx + 1) / total, message=f"skip:{tail}")
                continue

            try:
                body, fetched_ct = self.downloader(url)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{tail}: {exc}")
                logger.warning("files pull download failed id=%s url=%s err=%s", gid, url, exc)
                self._emit("file", progress=(idx + 1) / total, message=f"err:{tail}")
                continue

            content_type = ct or fetched_ct or "application/octet-stream"
            ext = _ext_from_url(url)
            relative_path = f"{tail}.{ext}" if ext else f"{tail}.bin"

            cas = put_or_link(self.r2_client, tenant_id, body, content_type)
            if cas["deduped"]:
                deduped_count += 1
            entries.append(
                {
                    "relative_path": relative_path,
                    "sha256": cas["sha256"],
                    "size": cas["size"],
                    "content_type": content_type,
                    "source_url": url,
                }
            )
            total_bytes += cas["size"]
            self._emit("file", progress=(idx + 1) / total, message=relative_path)

        self._emit("manifest_writing", progress=0.99, message="manifest.json")
        manifest_key = write_manifest(self.r2_client, prefix, entries)

        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "files pull done shop=%s snapshot=%s files=%d deduped=%d bytes=%d errors=%d elapsed=%ss",
            shop_domain,
            snapshot_id,
            len(entries),
            deduped_count,
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
            # Trim to keep response small; full detail goes to log.
            out["errors"] = errors[:10]
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

        synthetic = [
            (
                "1001.jpg",
                b"\xff\xd8\xff\xe0DRY-RUN-FILE-IMG\n"
                + f"snapshot_id={snapshot_id}".encode("utf-8"),
                "image/jpeg",
                "https://cdn/dry-run/files/1001.jpg",
            ),
            (
                "1002.pdf",
                b"%PDF-1.4 DRY-RUN\n"
                + f"snapshot_id={snapshot_id}".encode("utf-8"),
                "application/pdf",
                "https://cdn/dry-run/files/1002.pdf",
            ),
        ]

        entries: list[ManifestEntry] = []
        total_bytes = 0
        deduped_count = 0
        for relative_path, body, content_type, src in synthetic:
            cas = _safe_put_or_link(self.r2_client, tenant_id, body, content_type)
            if cas["deduped"]:
                deduped_count += 1
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

        manifest_key = _safe_write_manifest(self.r2_client, prefix, entries)

        logger.info(
            "files pull DRY-RUN shop=%s snapshot=%s synthetic=%d",
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
