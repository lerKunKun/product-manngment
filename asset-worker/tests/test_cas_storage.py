"""Tests for the CAS layer (app.services.cas_storage)."""
from __future__ import annotations

import hashlib
from unittest.mock import MagicMock

from app.services.cas_storage import put_or_link


TENANT = 7
PAYLOAD = b"hello world\n"
SHA = hashlib.sha256(PAYLOAD).hexdigest()
EXPECTED_KEY = f"tenants/{TENANT}/cas/{SHA[:2]}/{SHA}"


def test_put_or_link_miss_uploads_with_content_type():
    r2 = MagicMock()
    # Simulate a CAS miss: head_object returns False so we PUT.
    r2.head_object.return_value = False

    result = put_or_link(r2, TENANT, PAYLOAD, "text/plain")

    assert result["sha256"] == SHA
    assert result["size"] == len(PAYLOAD)
    assert result["cas_key"] == EXPECTED_KEY
    assert result["deduped"] is False
    assert result["content_type"] == "text/plain"

    r2.head_object.assert_called_once_with(EXPECTED_KEY)
    r2.put_object.assert_called_once_with(
        EXPECTED_KEY, PAYLOAD, content_type="text/plain"
    )


def test_put_or_link_hit_skips_put():
    r2 = MagicMock()
    r2.head_object.return_value = True

    result = put_or_link(r2, TENANT, PAYLOAD, "image/png")

    assert result["sha256"] == SHA
    assert result["cas_key"] == EXPECTED_KEY
    assert result["deduped"] is True
    assert result["content_type"] == "image/png"
    r2.head_object.assert_called_once_with(EXPECTED_KEY)
    r2.put_object.assert_not_called()


def test_put_or_link_handles_none_content_type():
    r2 = MagicMock()
    r2.head_object.return_value = False

    result = put_or_link(r2, TENANT, PAYLOAD, None)

    assert result["content_type"] is None
    assert result["deduped"] is False
    # PUT still called; content_type passed through as None.
    r2.put_object.assert_called_once_with(
        EXPECTED_KEY, PAYLOAD, content_type=None
    )


def test_put_or_link_without_head_object_falls_through_to_put():
    """A client that doesn't expose head_object (e.g. a primitive stub)
    must not fail — we fall back to PUT so dedup is best-effort."""

    class _NoHead:
        def __init__(self) -> None:
            self.put_calls: list[tuple] = []

        def put_object(self, key, body, content_type=None):
            self.put_calls.append((key, body, content_type))

    r2 = _NoHead()
    result = put_or_link(r2, TENANT, PAYLOAD, "application/json")
    assert result["deduped"] is False
    assert r2.put_calls == [(EXPECTED_KEY, PAYLOAD, "application/json")]


def test_cas_key_uses_sha_prefix_for_sharding():
    """Sanity check: the first two hex chars of sha go into the key path.

    Guards against a regression where the sharding prefix is lost — the
    design doc explicitly relies on it for filesystem-style fan-out.
    """
    r2 = MagicMock()
    r2.head_object.return_value = False

    out = put_or_link(r2, 42, b"a", "text/plain")
    sha = hashlib.sha256(b"a").hexdigest()
    assert out["cas_key"] == f"tenants/42/cas/{sha[:2]}/{sha}"
