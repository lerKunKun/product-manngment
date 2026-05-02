"""
Shared helpers for dry-run mode of pull services.

Background (W2-SNAP-04 verification): the worker's pull services historically
synthesized a manifest in memory but did NOT upload anything. As a result the
backend's snapshot-generation step that follows ``downloadBytes(productJsonKey)``
got NoSuchKey 404. The fix is to make dry-run also upload synthetic bytes to R2
when R2 is configured (dev = MinIO), but stay tolerant of R2 not being wired up
(no env) so dev-without-MinIO still works as before.
"""
from __future__ import annotations

import json as _json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def synthetic_text_bytes(snapshot_id: int, path: str) -> bytes:
    """Deterministic synthetic body for non-JSON dry-run files."""
    return (
        f"# dry-run synthetic content for {path}\nsnapshot_id={snapshot_id}\n"
    ).encode("utf-8")


def synthetic_json_bytes(snapshot_id: int, path: str) -> bytes:
    """Deterministic synthetic JSON body for dry-run files."""
    return _json.dumps(
        {"dry_run": True, "snapshot_id": snapshot_id, "path": path},
        ensure_ascii=False,
        indent=2,
    ).encode("utf-8")


def try_put_object(
    r2_client: Any,
    key: str,
    body: bytes,
    content_type: str,
) -> None:
    """Upload to R2; swallow any error so the dry-run manifest still returns.

    Without this, an unconfigured R2 (no env) would crash dry-run callers that
    used to be a pure in-memory shim. With R2 configured (dev = MinIO) the
    upload succeeds and downstream consumers can fetch the bytes.
    """
    try:
        r2_client.put_object(key, body, content_type=content_type)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "dry-run R2 upload failed (continuing in-memory only): key=%s err=%s",
            key,
            exc,
        )
