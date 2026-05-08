"""
Cloudflare R2 / S3-compatible object storage client.

Thin wrapper around boto3's S3 client configured for path-style addressing
(required by R2 and MinIO). Construction is always cheap and never raises;
missing credentials only surface as RuntimeError when an actual operation
is attempted, so import-time / healthcheck paths stay green even when the
service is started without configured secrets.
"""
from __future__ import annotations

import logging
from typing import Optional

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)


class R2Client:
    """boto3 S3 client wrapper for Cloudflare R2 (or any S3-compatible store)."""

    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str = "auto",
    ) -> None:
        self.endpoint = endpoint or ""
        self.access_key = access_key or ""
        self.secret_key = secret_key or ""
        self.bucket = bucket or ""
        self.region = region or "auto"
        self._client = None  # lazy

    # ------------------------------------------------------------------ internals

    def _ensure_configured(self) -> None:
        missing = [
            name
            for name, value in (
                ("endpoint", self.endpoint),
                ("access_key", self.access_key),
                ("secret_key", self.secret_key),
                ("bucket", self.bucket),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(
                f"R2Client is not configured: missing {', '.join(missing)}"
            )

    def _get_client(self):
        if self._client is None:
            self._ensure_configured()
            self._client = boto3.client(
                "s3",
                endpoint_url=self.endpoint,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name=self.region,
                config=Config(
                    signature_version="s3v4",
                    s3={"addressing_style": "path"},
                ),
            )
        return self._client

    # -------------------------------------------------------------------- public

    def put_object(
        self,
        key: str,
        body: bytes,
        content_type: Optional[str] = None,
    ) -> None:
        """Upload bytes to ``bucket/key``. Raises RuntimeError if not configured."""
        self._ensure_configured()
        client = self._get_client()
        kwargs = {
            "Bucket": self.bucket,
            "Key": key,
            "Body": body,
        }
        if content_type:
            kwargs["ContentType"] = content_type
        try:
            client.put_object(**kwargs)
            logger.debug(
                "r2 put_object bucket=%s key=%s size=%d",
                self.bucket,
                key,
                len(body),
            )
        except (BotoCoreError, ClientError) as exc:
            logger.error("r2 put_object failed for %s: %s", key, exc)
            raise

    def get_object(self, key: str) -> tuple[bytes, str]:
        """Download ``bucket/key`` and return ``(body_bytes, content_type)``.

        Raises ``RuntimeError`` if R2 is not configured (lazy: deferred until
        the first call). Underlying boto3 errors propagate as
        ``BotoCoreError`` / ``ClientError`` so callers can map to 502 etc.
        """
        self._ensure_configured()
        client = self._get_client()
        try:
            response = client.get_object(Bucket=self.bucket, Key=key)
        except (BotoCoreError, ClientError) as exc:
            logger.error("r2 get_object failed for %s: %s", key, exc)
            raise
        body_stream = response["Body"]
        try:
            body_bytes = body_stream.read()
        finally:
            try:
                body_stream.close()
            except Exception:  # noqa: BLE001 - best-effort close
                pass
        content_type = response.get("ContentType", "application/octet-stream")
        logger.debug(
            "r2 get_object bucket=%s key=%s size=%d content_type=%s",
            self.bucket,
            key,
            len(body_bytes),
            content_type,
        )
        return body_bytes, content_type

    def head_object(self, key: str) -> bool:
        """Return True iff an object exists at ``bucket/key``.

        Used by the CAS dedup layer (:mod:`app.services.cas_storage`):
        a hit lets the caller skip the PUT. Any error short of a clean
        200 returns ``False`` so the caller falls through to PUT, which
        is idempotent on byte-identical content.
        """
        try:
            self._ensure_configured()
            client = self._get_client()
            client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as exc:
            code = ""
            if exc.response is not None:
                code = exc.response.get("Error", {}).get("Code", "")
            if code in {"404", "NoSuchKey", "NotFound"}:
                return False
            logger.debug("r2 head_object key=%s client-error=%s", key, code)
            return False
        except (BotoCoreError, RuntimeError) as exc:
            logger.debug("r2 head_object key=%s err=%s", key, exc)
            return False

    def head_bucket(self) -> bool:
        """Return True if the bucket exists & is reachable; False otherwise.

        Used by healthchecks; never raises so the /health endpoint stays cheap.
        """
        try:
            self._ensure_configured()
            self._get_client().head_bucket(Bucket=self.bucket)
            return True
        except Exception as exc:  # noqa: BLE001 - intentional swallow
            logger.debug("r2 head_bucket failed: %s", exc)
            return False

    def ensure_bucket(self) -> None:
        """Verify the bucket exists; create it if missing.

        Called once at worker startup to fail fast when an operator forgot
        to provision the R2 bucket — instead of letting the first /pull/*
        crash on ``NoSuchBucket`` and surface as a generic 500.

        Behaviour matrix:
          - head_bucket 200            → no-op
          - head_bucket 404/NoSuchBucket → create_bucket; on 403 (token
            lacks bucket-admin) raise RuntimeError with an actionable hint
          - head_bucket 403            → assume bucket exists, token just
            lacks list/head perms (common with R2 data-plane tokens)
          - any other transport error → log + assume reachable; let the
            real put/get raise later
        """
        self._ensure_configured()
        client = self._get_client()
        try:
            client.head_bucket(Bucket=self.bucket)
            logger.info("r2 bucket '%s' OK", self.bucket)
            return
        except ClientError as exc:
            code = ""
            status = 0
            if exc.response is not None:
                code = exc.response.get("Error", {}).get("Code", "") or ""
                status = exc.response.get("ResponseMetadata", {}).get(
                    "HTTPStatusCode", 0
                )
            if code in {"404", "NoSuchBucket", "NotFound"} or status == 404:
                self._create_bucket(client)
                return
            if code in {"403", "Forbidden", "AccessDenied"} or status == 403:
                logger.warning(
                    "r2 head_bucket forbidden bucket=%s — token likely has "
                    "object-only scope, assuming bucket exists",
                    self.bucket,
                )
                return
            logger.warning(
                "r2 head_bucket bucket=%s code=%s status=%s — assuming reachable",
                self.bucket,
                code,
                status,
            )
        except BotoCoreError as exc:
            logger.warning(
                "r2 head_bucket transport error bucket=%s err=%s — assuming reachable",
                self.bucket,
                exc,
            )

    def _create_bucket(self, client) -> None:
        try:
            client.create_bucket(Bucket=self.bucket)
            logger.info("r2 bucket '%s' created", self.bucket)
        except ClientError as exc:
            code = ""
            if exc.response is not None:
                code = exc.response.get("Error", {}).get("Code", "") or ""
            if code in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
                logger.info("r2 bucket '%s' already exists (raced)", self.bucket)
                return
            raise RuntimeError(
                f"R2 bucket '{self.bucket}' is missing and auto-create failed "
                f"({code or exc}). Create it manually in the Cloudflare R2 "
                f"dashboard, or grant the API token bucket-admin permission. "
                f"To skip this check, set R2_BUCKET_ENSURE=false."
            ) from exc
