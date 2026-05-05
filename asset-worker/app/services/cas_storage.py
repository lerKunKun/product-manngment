"""
Content-addressable storage (CAS) layer for resource bytes.

Track AS2 / `店铺资产同步与跨店迁移-评估.md` §2.2: every byte we pull from
Shopify is keyed by its SHA-256 under ``tenants/{tid}/cas/{sha[:2]}/{sha}``
so the same theme file / product image shared across stores or snapshots
only takes one slot in R2. Pull services call :func:`put_or_link` for
each artifact and append the returned ``sha256`` to a manifest, which is
written separately by :mod:`app.services.manifest_writer`.

The HEAD-then-PUT race is deliberately tolerated: if two writers race
on the same digest, both PUT the identical bytes to the same key — R2
last-writer-wins on byte-identical content is a no-op.

Backfill story for the legacy per-snapshot layout written by V8/V12:
TODO follow-up — once a backfill script is in (separate ticket) it
will (a) re-read each old ``r2_key``, (b) call :func:`put_or_link`,
(c) update ``asset_file.blob_sha256`` and bump
``asset_blob.ref_count``. Not done in this change.
"""
from __future__ import annotations

import hashlib
import logging
from typing import Any, Optional, TypedDict

try:  # boto3 is a runtime dep, but keep import resilient for unit-test envs.
    from botocore.exceptions import ClientError as _ClientError
except Exception:  # noqa: BLE001 - any import failure: degrade to a sentinel.
    class _ClientError(Exception):  # type: ignore[no-redef]
        """Fallback when botocore isn't importable (test-only)."""

        @property
        def response(self):  # noqa: D401 - mimic boto3 interface
            return {}


ClientError = _ClientError

logger = logging.getLogger(__name__)


class CasPutResult(TypedDict):
    sha256: str
    size: int
    cas_key: str
    deduped: bool
    content_type: Optional[str]


def _cas_key(tenant_id: int, sha256_hex: str) -> str:
    """Return the CAS object key for a tenant + digest pair."""
    return f"tenants/{tenant_id}/cas/{sha256_hex[:2]}/{sha256_hex}"


def _head_exists(r2_client: Any, key: str) -> bool:
    """Return True iff R2 already has an object at ``key``.

    Falls back to False (i.e. "needs PUT") on any error path that isn't a
    clean 200 — better to over-PUT (idempotent) than to skip a real upload.

    Supports two client shapes:

    * ``R2Client``-style wrappers exposing ``head_object(key)`` (preferred).
    * Raw boto3 clients exposing ``head_object(Bucket=..., Key=...)`` and
      a ``bucket`` attribute.

    Test doubles (``MagicMock``) trip the first branch and we read the
    return value directly — see tests for the contract.
    """
    head = getattr(r2_client, "head_object", None)
    if head is None:
        return False
    try:
        # Prefer the wrapper shape: head_object(key) -> bool|dict|None.
        try:
            result = head(key)
        except TypeError:
            # boto3 raw client: needs Bucket=...
            bucket = getattr(r2_client, "bucket", None)
            if not bucket:
                return False
            result = head(Bucket=bucket, Key=key)
    except ClientError as exc:
        # 404 / NoSuchKey is the common "not found" path; everything else
        # we also treat as not-found and let the PUT settle reality.
        code = exc.response.get("Error", {}).get("Code") if exc.response else ""
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        logger.debug("cas head_object client error key=%s code=%s", key, code)
        return False
    except Exception as exc:  # noqa: BLE001 - defensive
        logger.debug("cas head_object swallowed key=%s err=%s", key, exc)
        return False

    if result is None:
        return False
    if isinstance(result, bool):
        return result
    # boto3 returns a dict on success.
    return True


def put_or_link(
    r2_client: Any,
    tenant_id: int,
    payload: bytes,
    content_type: Optional[str],
) -> CasPutResult:
    """Compute sha256, ensure CAS object exists, return metadata.

    Algorithm (matches design doc §2.2):

    1. ``sha = sha256(payload).hexdigest()``
    2. ``cas_key = "tenants/{tid}/cas/{sha[:2]}/{sha}"``
    3. HEAD ``cas_key`` → exists? → ``deduped=True``, skip PUT
    4. else: PUT bytes with ``content_type`` (when given) → ``deduped=False``

    Returns the digest, size, key, dedup flag and the content_type passed
    through (for manifest emission). Never raises on dedup-detection
    failure — it just falls through to PUT, which is idempotent on
    byte-identical content.
    """
    sha = hashlib.sha256(payload).hexdigest()
    cas_key = _cas_key(tenant_id, sha)
    size = len(payload)

    if _head_exists(r2_client, cas_key):
        logger.debug(
            "cas hit tenant=%s sha=%s size=%d", tenant_id, sha, size
        )
        return {
            "sha256": sha,
            "size": size,
            "cas_key": cas_key,
            "deduped": True,
            "content_type": content_type,
        }

    # Miss: upload. R2Client.put_object signature is (key, body, content_type=...).
    r2_client.put_object(cas_key, payload, content_type=content_type)
    logger.debug(
        "cas miss tenant=%s sha=%s size=%d ct=%s",
        tenant_id,
        sha,
        size,
        content_type,
    )
    return {
        "sha256": sha,
        "size": size,
        "cas_key": cas_key,
        "deduped": False,
        "content_type": content_type,
    }
