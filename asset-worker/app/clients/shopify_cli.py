"""
Shopify CLI token client.

Wraps `shopify` CLI subprocess to obtain developer-style access tokens
(`shpat_*` / `shpca_*`) and caches them on disk with a TTL. All access
is serialized via a process-local lock so concurrent callers don't
trigger duplicate refreshes.
"""
from __future__ import annotations

import json
import logging
import subprocess
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULT_CACHE_DIR = Path.home() / ".cache" / "shopify-hub" / "cli-tokens.json"
_DEFAULT_CMD_TEMPLATE = ["shopify", "store", "auth", "{shop}"]
_TOKEN_PREFIXES = ("shpat_", "shpca_")
_SUBPROCESS_TIMEOUT_SECONDS = 60


class ShopifyCliError(Exception):
    """Raised when the Shopify CLI subprocess fails or returns no usable token."""


class ShopifyCliClient:
    """Synchronous Shopify CLI token client with on-disk cache + TTL."""

    def __init__(
        self,
        cache_dir: Path | None = None,
        refresh_cmd_template: list[str] | None = None,
        ttl_seconds: int = 3600,
    ) -> None:
        self.cache_path: Path = Path(cache_dir) if cache_dir is not None else _DEFAULT_CACHE_DIR
        self.refresh_cmd_template: list[str] = (
            list(refresh_cmd_template) if refresh_cmd_template is not None else list(_DEFAULT_CMD_TEMPLATE)
        )
        self.ttl_seconds: int = ttl_seconds
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ public

    def get_token(self, shop_domain: str) -> str:
        """Return a fresh access token for the given shop, refreshing if needed."""
        with self._lock:
            cached = self._read_cache_entry(shop_domain)
            now = time.time()
            if cached is not None and cached.get("expires_at", 0) > now:
                logger.debug("shopify-cli cache hit for %s", shop_domain)
                return cached["token"]

            logger.info("shopify-cli cache miss for %s; invoking refresh", shop_domain)
            token = self._refresh_token(shop_domain)
            self._write_cache_entry(shop_domain, token, now + self.ttl_seconds)
            return token

    # ----------------------------------------------------------------- internal

    def _read_cache(self) -> dict:
        try:
            with self.cache_path.open("r", encoding="utf-8") as fp:
                data = json.load(fp)
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("shopify-cli cache unreadable (%s); treating as empty", exc)
            return {}
        if not isinstance(data, dict):
            return {}
        return data

    def _read_cache_entry(self, shop_domain: str) -> dict | None:
        data = self._read_cache()
        entry = data.get(shop_domain)
        if isinstance(entry, dict) and "token" in entry:
            return entry
        return None

    def _write_cache_entry(self, shop_domain: str, token: str, expires_at: float) -> None:
        data = self._read_cache()
        data[shop_domain] = {"token": token, "expires_at": expires_at}
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self.cache_path.with_suffix(self.cache_path.suffix + ".tmp")
            with tmp_path.open("w", encoding="utf-8") as fp:
                json.dump(data, fp)
            tmp_path.replace(self.cache_path)
        except OSError as exc:
            logger.warning("shopify-cli could not persist cache: %s", exc)

    def _refresh_token(self, shop_domain: str) -> str:
        cmd = [part.replace("{shop}", shop_domain) for part in self.refresh_cmd_template]
        logger.debug("running shopify-cli refresh: %s", cmd)
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=_SUBPROCESS_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            logger.error("shopify-cli refresh timed out for %s", shop_domain)
            raise ShopifyCliError(f"shopify CLI timed out after {_SUBPROCESS_TIMEOUT_SECONDS}s: {exc}") from exc
        except FileNotFoundError as exc:
            logger.error("shopify-cli executable not found: %s", exc)
            raise ShopifyCliError(f"shopify CLI executable not found: {exc}") from exc

        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            logger.error("shopify-cli refresh failed (rc=%s): %s", result.returncode, stderr)
            raise ShopifyCliError(stderr or f"shopify CLI exited with code {result.returncode}")

        token = self._parse_token(result.stdout or "")
        if not token:
            raise ShopifyCliError("shopify CLI produced no parseable token on stdout")
        return token

    @staticmethod
    def _parse_token(stdout: str) -> str | None:
        """Extract a token from CLI stdout.

        Strategy: scan every whitespace-separated word in every line and return
        the first one starting with a known token prefix. If no prefix match,
        fall back to the last whitespace-separated word on the last non-empty
        line.
        """
        lines = stdout.splitlines()
        for line in lines:
            for word in line.split():
                if word.startswith(_TOKEN_PREFIXES):
                    return word

        for line in reversed(lines):
            words = line.split()
            if words:
                return words[-1]
        return None
