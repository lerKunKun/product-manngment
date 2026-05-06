"""
Asset Worker - FastAPI service for Shopify asset pull/push operations.
Wave 0: minimal skeleton with /health endpoint.
"""
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import boto3
from botocore.client import Config
from fastapi import FastAPI

from app.config import settings
from app.routes import diff as diff_routes
from app.routes import preview as preview_routes
from app.routes import pull as pull_routes
from app.routes import push as push_routes


def _build_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
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
