"""
Manifest writer for the CAS-backed snapshot layout.

Track AS2: each pull no longer copies the bytes per-snapshot. Instead it
points at CAS via ``sha256`` and writes a single ``manifest.json`` next
to the snapshot prefix listing every entry. The manifest is the only
per-snapshot artifact under ``tenants/{tid}/stores/{sid}/snapshots/{sid}/``.

Schema (version 1):

.. code-block:: json

    {
      "version": 1,
      "generated_at": "2026-05-05T03:14:15.000+00:00",
      "entries": [
        {
          "relative_path": "templates/index.json",
          "sha256": "abc...",
          "size": 1234,
          "content_type": "application/json",
          "source_url": null
        }
      ]
    }

``source_url`` exists for the product image case (Shopify CDN URL we
fetched the bytes from); other producers leave it ``None``.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional, TypedDict

logger = logging.getLogger(__name__)


class ManifestEntry(TypedDict, total=False):
    relative_path: str
    sha256: str
    size: int
    content_type: Optional[str]
    source_url: Optional[str]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_manifest(
    r2_client: Any,
    snapshot_prefix: str,
    entries: list[ManifestEntry],
) -> str:
    """Serialize ``entries`` and PUT ``{snapshot_prefix}/manifest.json``.

    ``snapshot_prefix`` may be passed with or without a trailing slash —
    we normalise so the resulting key is always
    ``"<prefix>/manifest.json"`` exactly once. Returns the manifest key.
    """
    prefix = snapshot_prefix.rstrip("/")
    manifest_key = f"{prefix}/manifest.json"

    body = {
        "version": 1,
        "generated_at": _now_iso(),
        "entries": entries,
    }
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    r2_client.put_object(manifest_key, payload, content_type="application/json")
    logger.debug(
        "manifest written key=%s entry_count=%d size=%d",
        manifest_key,
        len(entries),
        len(payload),
    )
    return manifest_key
