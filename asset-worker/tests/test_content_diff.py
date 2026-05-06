"""Tests for app.services.content_diff."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from app.services.content_diff import (
    KIND_BINARY,
    KIND_MISSING,
    KIND_STRUCTURED,
    KIND_TEXT,
    _classify,
    _looks_textual,
    diff_one,
    diff_paths,
)


# --------------------------------------------------------------------- helpers


def _entry(path: str, sha: str, size: int, content_type: str | None = None) -> dict:
    return {
        "relative_path": path,
        "sha256": sha,
        "size": size,
        "content_type": content_type,
    }


def _r2_with(payloads: dict[str, bytes]) -> MagicMock:
    """Build a mock R2 whose get_object(key) returns payloads[key].

    Manifests are written under ``{prefix}/manifest.json``; CAS bytes are
    under ``tenants/{tid}/cas/{sha[:2]}/{sha}``. The caller seeds both.
    """
    r2 = MagicMock()

    def _get(key: str):
        if key not in payloads:
            raise KeyError(f"unexpected get_object key={key}")
        return payloads[key], "application/octet-stream"

    r2.get_object.side_effect = _get
    return r2


def _cas_key(tid: int, sha: str) -> str:
    return f"tenants/{tid}/cas/{sha[:2]}/{sha}"


def _manifest_bytes(entries: list[dict]) -> bytes:
    return json.dumps({"version": 1, "generated_at": "t", "entries": entries}).encode()


# ---------------------------------------------------------------- classifiers


def test_classify_known_text_extension():
    assert _classify("templates/index.json", None) == KIND_STRUCTURED
    assert _classify("snippets/foo.liquid", None) == KIND_TEXT
    assert _classify("assets/style.css", None) == KIND_TEXT


def test_classify_known_binary_extension():
    assert _classify("files/banner.png", None) == KIND_BINARY
    assert _classify("media/logo.webp", None) == KIND_BINARY


def test_classify_unknown_falls_back_to_byte_sniff():
    # NUL byte → binary
    assert _classify("weird.dat", b"prefix\x00\x00rest") == KIND_BINARY
    # plain ascii → text
    assert _classify("weird.dat", b"hello world\n") == KIND_TEXT


def test_looks_textual_empty_payload_is_text():
    assert _looks_textual(b"") is True


# ---------------------------------------------------------------- text diff


def test_diff_one_text_unified_diff_contains_markers():
    tid = 1
    sha_a, sha_b = "a" * 64, "b" * 64
    a_bytes = b"hello world\nsecond line\n"
    b_bytes = b"hello WORLD\nsecond line\n"
    r2 = _r2_with({_cas_key(tid, sha_a): a_bytes, _cas_key(tid, sha_b): b_bytes})

    out = diff_one(
        r2, tid, "snippets/foo.liquid",
        _entry("snippets/foo.liquid", sha_a, len(a_bytes), "text/plain"),
        _entry("snippets/foo.liquid", sha_b, len(b_bytes), "text/plain"),
    )

    assert out["kind"] == KIND_TEXT
    assert out["sha_a"] == sha_a
    assert out["sha_b"] == sha_b
    assert out["size_a"] == len(a_bytes)
    assert out["size_b"] == len(b_bytes)
    # unified_diff produces - for removed and + for added
    assert "-hello world" in out["preview"]
    assert "+hello WORLD" in out["preview"]
    assert "snippets/foo.liquid" in out["preview"]


def test_diff_one_structured_json_uses_pretty_diff():
    tid = 2
    sha_a, sha_b = "1" * 64, "2" * 64
    a_bytes = json.dumps({"b": 2, "a": 1}).encode()
    b_bytes = json.dumps({"a": 1, "b": 99}).encode()
    r2 = _r2_with({_cas_key(tid, sha_a): a_bytes, _cas_key(tid, sha_b): b_bytes})

    out = diff_one(
        r2, tid, "templates/index.json",
        _entry("templates/index.json", sha_a, len(a_bytes), "application/json"),
        _entry("templates/index.json", sha_b, len(b_bytes), "application/json"),
    )
    assert out["kind"] == KIND_STRUCTURED
    # because we sort keys before diffing, only the value of 'b' changed
    assert "\"b\": 2" in out["preview"] or "-  \"b\": 2" in out["preview"]
    assert "\"b\": 99" in out["preview"] or "+  \"b\": 99" in out["preview"]


# ---------------------------------------------------------------- binary path


def test_diff_one_binary_skips_byte_diff():
    tid = 3
    sha_a, sha_b = "9" * 64, "8" * 64
    # 1 KB of pretend PNG bytes; classifier picks BINARY by extension regardless.
    a_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 1000
    b_bytes = b"\x89PNG\r\n\x1a\n" + b"\xff" * 1024
    r2 = _r2_with({_cas_key(tid, sha_a): a_bytes, _cas_key(tid, sha_b): b_bytes})

    out = diff_one(
        r2, tid, "files/banner.png",
        _entry("files/banner.png", sha_a, len(a_bytes), "image/png"),
        _entry("files/banner.png", sha_b, len(b_bytes), "image/png"),
    )
    assert out["kind"] == KIND_BINARY
    assert "binary file changed" in out["preview"]
    assert out["size_a"] == len(a_bytes)
    assert out["size_b"] == len(b_bytes)


# ---------------------------------------------------------------- missing/edge


def test_diff_one_missing_in_both_entries():
    r2 = MagicMock()
    out = diff_one(r2, 1, "nope/path.json", None, None)
    assert out["kind"] == KIND_MISSING
    assert "not in either manifest" in out["preview"]
    # never touched R2
    r2.get_object.assert_not_called()


def test_diff_one_only_in_b_returns_added_marker():
    r2 = MagicMock()
    out = diff_one(
        r2, 1, "products/200.json",
        None,
        _entry("products/200.json", "x" * 64, 5, "application/json"),
    )
    assert out["preview"].startswith("[ADDED")
    assert out["sha_b"] == "x" * 64
    assert out["sha_a"] is None
    r2.get_object.assert_not_called()


def test_diff_one_only_in_a_returns_removed_marker():
    r2 = MagicMock()
    out = diff_one(
        r2, 1, "products/100.json",
        _entry("products/100.json", "y" * 64, 3, "application/json"),
        None,
    )
    assert out["preview"].startswith("[REMOVED")
    assert out["sha_a"] == "y" * 64
    assert out["sha_b"] is None
    r2.get_object.assert_not_called()


def test_diff_one_unchanged_when_sha_match():
    r2 = MagicMock()
    sha = "z" * 64
    out = diff_one(
        r2, 1, "shop_settings.json",
        _entry("shop_settings.json", sha, 10),
        _entry("shop_settings.json", sha, 10),
    )
    assert "[UNCHANGED" in out["preview"]
    r2.get_object.assert_not_called()


# ---------------------------------------------------------------- diff_paths

def test_diff_paths_loads_both_manifests_then_diffs():
    tid = 7
    sha_a, sha_b = "a" * 64, "b" * 64
    prefix_a = "tenants/7/stores/1/snapshots/100"
    prefix_b = "tenants/7/stores/2/snapshots/200"

    payloads = {
        f"{prefix_a}/manifest.json": _manifest_bytes([
            _entry("templates/index.json", sha_a, 4, "application/json"),
            _entry("removed.txt", "c" * 64, 5, "text/plain"),
        ]),
        f"{prefix_b}/manifest.json": _manifest_bytes([
            _entry("templates/index.json", sha_b, 4, "application/json"),
            _entry("added.txt", "d" * 64, 6, "text/plain"),
        ]),
        _cas_key(tid, sha_a): b"{\"x\":1}",
        _cas_key(tid, sha_b): b"{\"x\":2}",
    }
    r2 = _r2_with(payloads)

    result = diff_paths(r2, tid, prefix_a, prefix_b,
                        ["templates/index.json", "added.txt", "removed.txt", "ghost.json"])
    items = result["items"]
    by_path = {it["path"]: it for it in items}
    assert by_path["templates/index.json"]["kind"] == KIND_STRUCTURED
    assert by_path["added.txt"]["preview"].startswith("[ADDED")
    assert by_path["removed.txt"]["preview"].startswith("[REMOVED")
    assert by_path["ghost.json"]["kind"] == KIND_MISSING


def test_diff_paths_empty_paths_returns_empty():
    r2 = MagicMock()
    out = diff_paths(r2, 1, "p/a", "p/b", [])
    assert out == {"items": []}
    r2.get_object.assert_not_called()


# Optional smoke test that pydantic validation still fires through FastAPI's
# router can be added to e2e; here we just verify the service layer.

if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
