"""
Progress emitter (W2-AST-05).

Tiny HTTP-callback helper used by pull services to publish lifecycle
events (started / file / manifest_writing / completed / failed) to the
backend, which fans them out to frontend ``EventSource`` subscribers
over SSE.

Design notes
------------

* No-op when ``backend_url`` is empty — keeps dev / dry-run usable
  without standing up the backend.
* Failures are swallowed (debug-logged): progress is never load-bearing
  for the pull pipeline.
* Lazy ``httpx.Client`` so a no-op emitter has zero side effects.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import httpx

log = logging.getLogger(__name__)


class ProgressEmitter:
    """HTTP POST progress events to backend; no-op if ``backend_url`` empty."""

    def __init__(
        self,
        backend_url: str,
        snapshot_id: int,
        internal_token: str = "",
        timeout: float = 3.0,
    ) -> None:
        self.backend_url = backend_url.rstrip("/") if backend_url else ""
        self.snapshot_id = snapshot_id
        self.internal_token = internal_token
        self.timeout = timeout
        self._client: Optional[httpx.Client] = None

    def _client_or_none(self) -> Optional[httpx.Client]:
        if not self.backend_url:
            return None
        if self._client is None:
            self._client = httpx.Client(timeout=self.timeout)
        return self._client

    def emit(
        self,
        event: str,
        *,
        progress: float | None = None,
        message: str = "",
        **extra,
    ) -> None:
        c = self._client_or_none()
        if c is None:
            return  # disabled in dev / no backend configured
        payload = {
            "snapshotId": self.snapshot_id,
            "event": event,
            "progress": progress,
            "message": message,
            "ts": time.time(),
            **extra,
        }
        try:
            headers = (
                {"X-Internal-Token": self.internal_token}
                if self.internal_token
                else {}
            )
            c.post(
                f"{self.backend_url}/api/internal/asset/progress",
                json=payload,
                headers=headers,
            )
        except Exception as e:  # noqa: BLE001 — non-fatal by design
            log.debug("progress emit failed (non-fatal): %s", e)

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:  # noqa: BLE001
                pass
            self._client = None
