"""Tests for app.services.manifest_writer."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from app.services.manifest_writer import write_manifest


def test_write_manifest_puts_at_expected_key_and_returns_it():
    r2 = MagicMock()
    prefix = "tenants/1/stores/3/snapshots/42"
    entries = [
        {
            "relative_path": "templates/index.json",
            "sha256": "a" * 64,
            "size": 17,
            "content_type": "application/json",
            "source_url": None,
        }
    ]

    key = write_manifest(r2, prefix, entries)

    assert key == "tenants/1/stores/3/snapshots/42/manifest.json"
    r2.put_object.assert_called_once()
    pos_args = r2.put_object.call_args.args
    assert pos_args[0] == key
    body = pos_args[1]
    parsed = json.loads(body.decode("utf-8"))
    assert parsed["version"] == 1
    assert parsed["entries"] == entries
    assert "generated_at" in parsed
    # content_type should be application/json
    assert r2.put_object.call_args.kwargs.get("content_type") == "application/json"


def test_write_manifest_normalises_trailing_slash():
    r2 = MagicMock()
    prefix = "tenants/1/stores/3/snapshots/42/"  # trailing slash

    key = write_manifest(r2, prefix, [])

    # No double slash — exactly one between prefix and filename.
    assert key == "tenants/1/stores/3/snapshots/42/manifest.json"


def test_write_manifest_serialises_unicode():
    r2 = MagicMock()
    entries = [
        {
            "relative_path": "policies/隐私政策.json",
            "sha256": "b" * 64,
            "size": 8,
            "content_type": "application/json",
            "source_url": None,
        }
    ]
    write_manifest(r2, "tenants/1/stores/3/snapshots/42", entries)
    body = r2.put_object.call_args.args[1]
    text = body.decode("utf-8")
    # ensure_ascii=False means the Chinese path stays literal in the JSON.
    assert "隐私政策" in text
