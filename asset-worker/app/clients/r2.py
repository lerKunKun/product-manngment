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
