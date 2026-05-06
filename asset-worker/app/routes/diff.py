"""
``POST /diff/content`` — second/third layer diff endpoint (Track AS4).

The backend ``DiffService`` does the manifest (one-layer) diff itself by
reading two ``manifest.json`` files. When the user wants to actually see
unified diff text for a specific file, that request gets forwarded here
(see ``DiffService.computeContentDiff``).

Errors:

* 503 when R2 isn't configured (``RuntimeError`` from R2Client).
* 502 when a manifest fetch fails mid-diff (``ClientError`` /
  ``BotoCoreError`` propagated as ``Exception``).
* 422 when ``paths`` is empty / oversized (FastAPI validates).
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.clients.r2 import R2Client
from app.config import settings
from app.services.content_diff import diff_paths

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/diff", tags=["diff"])


class ContentDiffRequest(BaseModel):
    tenant_id: int = Field(..., gt=0)
    snapshot_a_prefix: str = Field(..., min_length=1)
    snapshot_b_prefix: str = Field(..., min_length=1)
    paths: list[str] = Field(..., min_length=1, max_length=50)


_r2_client: Optional[R2Client] = None


def _get_r2_client() -> R2Client:
    global _r2_client
    if _r2_client is None:
        _r2_client = R2Client(
            endpoint=settings.r2_endpoint,
            access_key=settings.r2_access_key_id,
            secret_key=settings.r2_secret_access_key,
            bucket=settings.r2_bucket,
            region=settings.r2_region,
        )
    return _r2_client


@router.post("/content")
async def post_content_diff(req: ContentDiffRequest) -> dict:
    """Run per-path text/binary diffs and return a list of result records."""
    try:
        return await run_in_threadpool(
            diff_paths,
            _get_r2_client(),
            req.tenant_id,
            req.snapshot_a_prefix,
            req.snapshot_b_prefix,
            req.paths,
        )
    except RuntimeError as exc:
        logger.warning("/diff/content runtime error: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — last-resort failsafe
        logger.exception("/diff/content unexpected error")
        raise HTTPException(status_code=502, detail=f"diff failed: {exc}") from exc
