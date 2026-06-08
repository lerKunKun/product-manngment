"""
Asset Worker - FastAPI service for Shopify asset pull/push operations.
Wave 0: minimal skeleton with /health endpoint.
"""
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import boto3
from botocore.client import Config
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.clients.r2 import R2Client
from app.config import settings
from app.routes import diff as diff_routes
from app.routes import preview as preview_routes
from app.routes import pull as pull_routes
from app.routes import push as push_routes

logger = logging.getLogger(__name__)

_AUTH_EXEMPT_PATHS = {"/", "/health", "/cli/health"}


def _extract_worker_token(request: Request) -> str:
    token = request.headers.get("X-Worker-Token", "")
    if token:
        return token
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:]
    return ""


def _build_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _ensure_r2_bucket_or_die() -> None:
    """Fail fast at boot when the configured R2 bucket does not exist.

    Without this, the first /pull/* would call put_object on a missing
    bucket, boto3 would raise NoSuchBucket, and the symptom on the backend
    side is the unhelpful ``IOException: header parser received no bytes``
    when the request times out / connection is reset. We'd rather refuse
    to start than accept traffic in that state.

    Skipped when ``R2_BUCKET_ENSURE=false`` (escape hatch for when the
    operator has the bucket on a separate provider with no head/create
    permission for the worker token).
    """
    if not settings.r2_bucket_ensure:
        logger.info("[r2-bootstrap] R2_BUCKET_ENSURE=false, skipping")
        return
    if not (
        settings.r2_endpoint
        and settings.r2_access_key_id
        and settings.r2_secret_access_key
        and settings.r2_bucket
    ):
        logger.info("[r2-bootstrap] R2 not fully configured, skipping")
        return
    r2 = R2Client(
        endpoint=settings.r2_endpoint,
        access_key=settings.r2_access_key_id,
        secret_key=settings.r2_secret_access_key,
        bucket=settings.r2_bucket,
        region=settings.r2_region,
    )
    r2.ensure_bucket()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _ensure_r2_bucket_or_die()
    app.state.s3 = _build_s3_client()
    app.state.started_at = time.time()
    yield


app = FastAPI(
    title="Shopify Hub Asset Worker",
    version="0.1.0-alpha",
    lifespan=lifespan,
)
app.include_router(pull_routes.router)
app.include_router(push_routes.router)
app.include_router(preview_routes.router)
app.include_router(diff_routes.router)


@app.middleware("http")
async def require_worker_token(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path in _AUTH_EXEMPT_PATHS:
        return await call_next(request)

    expected = settings.asset_worker_token.strip()
    if not expected:
        logger.error("ASSET_WORKER_TOKEN is empty; rejecting worker API request")
        return JSONResponse(
            status_code=503,
            content={"detail": "ASSET_WORKER_TOKEN is not configured"},
        )

    if _extract_worker_token(request) != expected:
        return JSONResponse(status_code=401, content={"detail": "invalid worker token"})

    return await call_next(request)


@app.get("/health")
async def health():
    deps = {"r2": _check_r2(app)}
    return {
        "app": "asset-worker",
        "env": settings.app_env,
        "ts": datetime.now(timezone.utc).isoformat(),
        "uptime_sec": round(time.time() - app.state.started_at, 1),
        "status": "UP",
        "dependencies": deps,
    }


def _check_r2(app: FastAPI) -> str:
    try:
        app.state.s3.list_buckets()
        return "UP"
    except Exception as e:
        return f"DOWN: {e.__class__.__name__}"


@app.get("/")
async def root():
    return {"name": "asset-worker", "version": "0.1.0-alpha"}


@app.get("/cli/health")
async def cli_health():
    from app.clients.shopify_cli import ShopifyCliClient  # noqa: F401

    return {"status": "ok", "client": "loaded"}
