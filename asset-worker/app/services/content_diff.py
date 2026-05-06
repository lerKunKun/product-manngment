"""
Content-level diff service (Track AS4).

Backend ``DiffService`` already does the manifest-level (one-layer) diff
itself by reading two ``manifest.json`` files. For the deeper layers —
unified diff for text, byte-size delta for binaries — it forwards the
shortlist of paths here.

Inputs (POST /diff/content body):

* ``tenant_id``: int — must match both snapshots; we never cross tenants
  at the byte level even though manifests theoretically could.
* ``snapshot_a_prefix`` / ``snapshot_b_prefix``: str — exactly the
  ``r2_prefix`` columns from ``asset_snapshot``. The CAS layer doesn't
  live under these prefixes (it lives under ``tenants/{tid}/cas/...``)
  but ``manifest.json`` does, and that's how we find each side's sha256
  for a given path.
* ``paths``: list[str] — relative paths inside the manifest to diff.

Outputs (per path):

* ``kind``: TEXT | BINARY | STRUCTURED — second-/third-layer dispatch.
* ``preview``: unified diff text (text/structured) or a short note
  (binary), capped at 50 lines / a few KB.
* ``size_a`` / ``size_b``: bytes; useful even for binaries.
* ``sha_a`` / ``sha_b``: digests we resolved from the two manifests.

We deliberately keep this synchronous and thread-poolable — no asyncio
inside, the caller wraps with ``run_in_threadpool`` (see
``app/routes/diff.py``).
"""
from __future__ import annotations

import difflib
import json
import logging
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)

# Absolute caps so a giant minified JSON or a 5MB liquid file can't blow
# the response size. Tune carefully — frontend renders this in a <pre>.
_MAX_PREVIEW_LINES = 50
_MAX_PREVIEW_CHARS = 16 * 1024  # 16 KB
_MAX_DIFFABLE_BYTES = 1 * 1024 * 1024  # 1 MB per side

# Best-effort text-vs-binary classification by extension. We don't rely
# only on content_type because manifest_writer leaves it None for some
# entries. Anything not on either list gets a quick byte sniff.
_TEXT_EXTS = {
    ".liquid", ".html", ".htm", ".css", ".scss", ".js", ".mjs", ".ts",
    ".json", ".jsonc", ".md", ".txt", ".csv", ".tsv", ".xml", ".yml",
    ".yaml", ".svg", ".graphql", ".gql",
}
_BINARY_EXTS = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".ico", ".tiff",
    ".pdf", ".mp4", ".webm", ".mov", ".mp3", ".wav", ".woff", ".woff2",
    ".ttf", ".otf", ".eot", ".zip", ".gz", ".tar",
}
_STRUCTURED_EXTS = {".json", ".jsonc"}

KIND_TEXT = "TEXT"
KIND_BINARY = "BINARY"
KIND_STRUCTURED = "STRUCTURED"
KIND_MISSING = "MISSING"


def _ext(path: str) -> str:
    i = path.rfind(".")
    if i < 0:
        return ""
    return path[i:].lower()


def _looks_textual(payload: bytes) -> bool:
    """Quick heuristic for unknown extensions: NUL byte → binary; high
    8-bit ratio → binary; otherwise text. Cheap and good enough for
    Shopify theme + product JSON cases."""
    if not payload:
        return True
    if b"\x00" in payload[:4096]:
        return False
    sample = payload[:4096]
    high = sum(1 for b in sample if b >= 0x80)
    return (high / len(sample)) < 0.30


def _classify(path: str, payload: Optional[bytes]) -> str:
    ext = _ext(path)
    if ext in _STRUCTURED_EXTS:
        return KIND_STRUCTURED
    if ext in _TEXT_EXTS:
        return KIND_TEXT
    if ext in _BINARY_EXTS:
        return KIND_BINARY
    if payload is None:
        return KIND_TEXT  # fallback; preview will explain
    return KIND_TEXT if _looks_textual(payload) else KIND_BINARY


def _truncate_preview(lines: Iterable[str]) -> str:
    """Cap unified_diff output at line and char limits."""
    chunks: list[str] = []
    char_budget = _MAX_PREVIEW_CHARS
    line_budget = _MAX_PREVIEW_LINES
    truncated = False
    for ln in lines:
        if line_budget <= 0 or char_budget <= 0:
            truncated = True
            break
        if len(ln) > char_budget:
            chunks.append(ln[:char_budget])
            char_budget = 0
            truncated = True
            break
        chunks.append(ln)
        char_budget -= len(ln)
        line_budget -= 1
    out = "".join(chunks)
    if truncated:
        out += "\n... [truncated]"
    return out


def _decode_text(payload: bytes) -> str:
    """Lenient utf-8 decode — Shopify theme files are utf-8 in practice
    but a stray non-utf-8 byte shouldn't 500 the diff."""
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        return payload.decode("utf-8", errors="replace")


def _format_json_pretty(payload: bytes) -> Optional[str]:
    """Return pretty-printed JSON if payload parses; else None.
    Used for STRUCTURED diff so re-ordered keys don't show as noise."""
    try:
        obj = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True)


def _unified(a_text: str, b_text: str, path: str) -> str:
    a_lines = a_text.splitlines(keepends=True)
    b_lines = b_text.splitlines(keepends=True)
    diff = difflib.unified_diff(
        a_lines, b_lines,
        fromfile=f"a/{path}", tofile=f"b/{path}",
        lineterm="",
    )
    # difflib's unified_diff yields newline-stripped lines when lineterm=""
    # Reattach \n so the rendered <pre> keeps line breaks.
    return _truncate_preview(ln + "\n" for ln in diff)


# --------------------------------------------------------------------- public

def _load_manifest(r2_client: Any, prefix: str) -> dict[str, dict[str, Any]]:
    """Fetch ``{prefix}/manifest.json`` and index entries by relative_path."""
    if not prefix:
        return {}
    key = prefix.rstrip("/") + "/manifest.json"
    payload, _ = r2_client.get_object(key)
    body = json.loads(payload.decode("utf-8"))
    out: dict[str, dict[str, Any]] = {}
    for e in body.get("entries", []):
        rp = e.get("relative_path")
        if not rp:
            continue
        out[rp] = e
    return out


def _cas_key(tenant_id: int, sha256_hex: str) -> str:
    return f"tenants/{tenant_id}/cas/{sha256_hex[:2]}/{sha256_hex}"


def _fetch_payload(r2_client: Any, tenant_id: int, sha256_hex: Optional[str]) -> Optional[bytes]:
    if not sha256_hex:
        return None
    try:
        body, _ct = r2_client.get_object(_cas_key(tenant_id, sha256_hex))
    except Exception as exc:  # noqa: BLE001 — CAS missing → degrade to None
        logger.warning("content_diff cas miss tenant=%s sha=%s err=%s",
                       tenant_id, sha256_hex, exc)
        return None
    return body


def diff_one(
    r2_client: Any,
    tenant_id: int,
    path: str,
    entry_a: Optional[dict[str, Any]],
    entry_b: Optional[dict[str, Any]],
) -> dict[str, Any]:
    """Compute the per-path diff record returned to the backend."""
    sha_a = entry_a.get("sha256") if entry_a else None
    sha_b = entry_b.get("sha256") if entry_b else None
    size_a = int(entry_a.get("size", 0)) if entry_a else None
    size_b = int(entry_b.get("size", 0)) if entry_b else None
    content_type = (entry_b.get("content_type") if entry_b else None) or \
        (entry_a.get("content_type") if entry_a else None)

    base: dict[str, Any] = {
        "path": path,
        "size_a": size_a,
        "size_b": size_b,
        "sha_a": sha_a,
        "sha_b": sha_b,
        "content_type": content_type,
    }

    if entry_a is None and entry_b is None:
        base.update({"kind": KIND_MISSING, "preview": "[path not in either manifest]"})
        return base
    if entry_a is None:
        base.update({"kind": _classify(path, None), "preview": "[ADDED — only in B]"})
        return base
    if entry_b is None:
        base.update({"kind": _classify(path, None), "preview": "[REMOVED — only in A]"})
        return base
    if sha_a == sha_b and sha_a is not None:
        base.update({"kind": KIND_TEXT, "preview": "[UNCHANGED — sha match]"})
        return base

    # Both sides exist with differing sha → fetch bytes (with size guard).
    if (size_a or 0) > _MAX_DIFFABLE_BYTES or (size_b or 0) > _MAX_DIFFABLE_BYTES:
        base.update({
            "kind": KIND_BINARY,
            "preview": f"[skipped — size exceeds {_MAX_DIFFABLE_BYTES} bytes; "
                       f"sizeA={size_a} sizeB={size_b}]",
        })
        return base

    payload_a = _fetch_payload(r2_client, tenant_id, sha_a)
    payload_b = _fetch_payload(r2_client, tenant_id, sha_b)
    if payload_a is None or payload_b is None:
        base.update({
            "kind": KIND_BINARY,
            "preview": "[CAS fetch failed for one or both sides]",
        })
        return base

    kind = _classify(path, payload_b or payload_a)
    if kind == KIND_BINARY:
        base.update({
            "kind": KIND_BINARY,
            "preview": (
                f"[binary file changed; sizeA={len(payload_a)} sizeB={len(payload_b)}]"
            ),
        })
        return base

    if kind == KIND_STRUCTURED:
        pretty_a = _format_json_pretty(payload_a) or _decode_text(payload_a)
        pretty_b = _format_json_pretty(payload_b) or _decode_text(payload_b)
        base.update({
            "kind": KIND_STRUCTURED,
            "preview": _unified(pretty_a, pretty_b, path),
        })
        return base

    # text
    base.update({
        "kind": KIND_TEXT,
        "preview": _unified(_decode_text(payload_a), _decode_text(payload_b), path),
    })
    return base


def diff_paths(
    r2_client: Any,
    tenant_id: int,
    snapshot_a_prefix: str,
    snapshot_b_prefix: str,
    paths: list[str],
) -> dict[str, Any]:
    """Top-level entry — load both manifests once, then diff each path."""
    if not paths:
        return {"items": []}
    manifest_a = _load_manifest(r2_client, snapshot_a_prefix)
    manifest_b = _load_manifest(r2_client, snapshot_b_prefix)
    items: list[dict[str, Any]] = []
    for p in paths:
        items.append(diff_one(
            r2_client, tenant_id, p,
            manifest_a.get(p), manifest_b.get(p),
        ))
    return {
        "snapshot_a_prefix": snapshot_a_prefix,
        "snapshot_b_prefix": snapshot_b_prefix,
        "tenant_id": tenant_id,
        "items": items,
    }
