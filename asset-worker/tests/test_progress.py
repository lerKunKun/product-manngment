"""Tests for ProgressEmitter (W2-AST-05)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx

from app.services.progress import ProgressEmitter
from app.services.theme_pull import ThemePullService


# ----------------------------------------------------- in-memory recording emitter


class _RecordingEmitter(ProgressEmitter):
    """ProgressEmitter that records emit() calls without HTTP."""

    def __init__(self) -> None:
        super().__init__(backend_url="", snapshot_id=42)
        self.events: list[dict] = []

    def emit(self, event: str, *, progress=None, message: str = "", **extra) -> None:  # type: ignore[override]
        self.events.append(
            {
                "event": event,
                "progress": progress,
                "message": message,
                **extra,
            }
        )


# ----------------------------------------------------------------------- tests


def test_emit_no_op_when_url_empty():
    emitter = ProgressEmitter(backend_url="", snapshot_id=1)
    # Should not raise, should not create an httpx.Client.
    with patch("app.services.progress.httpx.Client") as MockClient:
        emitter.emit("started", message="hi")
        emitter.emit("file", progress=0.5, message="x")
    assert MockClient.call_count == 0
    assert emitter._client is None


def test_emit_posts_payload():
    fake_client = MagicMock()
    with patch(
        "app.services.progress.httpx.Client", return_value=fake_client
    ) as MockClient:
        emitter = ProgressEmitter(
            backend_url="http://backend.local/",
            snapshot_id=77,
            internal_token="secret",
        )
        emitter.emit("file", progress=0.25, message="templates/index.json")

    MockClient.assert_called_once_with(timeout=3.0)
    fake_client.post.assert_called_once()
    args, kwargs = fake_client.post.call_args
    # URL: trailing slash on backend_url stripped + /api/internal/asset/progress.
    assert args[0] == "http://backend.local/api/internal/asset/progress"
    body = kwargs["json"]
    assert body["snapshotId"] == 77
    assert body["event"] == "file"
    assert body["progress"] == 0.25
    assert body["message"] == "templates/index.json"
    assert "ts" in body
    assert kwargs["headers"] == {"X-Internal-Token": "secret"}


def test_emit_swallows_errors():
    fake_client = MagicMock()
    fake_client.post.side_effect = httpx.ConnectError("boom")
    with patch(
        "app.services.progress.httpx.Client", return_value=fake_client
    ):
        emitter = ProgressEmitter(
            backend_url="http://backend.local",
            snapshot_id=1,
        )
        # Must not raise.
        emitter.emit("started", message="x")
    fake_client.post.assert_called_once()


def test_pull_service_emits_lifecycle():
    """ThemePullService dry-run emits started → file×3 → manifest_writing → completed."""
    cli = MagicMock()
    r2 = MagicMock()
    rec = _RecordingEmitter()

    svc = ThemePullService(
        shopify_cli=cli, r2_client=r2, dry_run=True, progress=rec
    )
    out = svc.pull(
        shop_domain="demo.myshopify.com",
        tenant_id=1,
        store_id=2,
        snapshot_id=99,
    )
    assert out["file_count"] == 3

    events = [e["event"] for e in rec.events]
    assert events[0] == "started"
    assert events[-1] == "completed"
    assert "manifest_writing" in events
    file_events = [e for e in rec.events if e["event"] == "file"]
    assert len(file_events) == 3
    # Final "completed" carries the file_count + total_bytes summary.
    completed = rec.events[-1]
    assert completed["progress"] == 1.0
    assert completed["file_count"] == 3
    assert completed["total_bytes"] > 0
