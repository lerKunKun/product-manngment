"""
Theme zip push (W3-NEW-06 + W3-NEW-07).

Pull a theme zip from R2, optionally apply replace_rules to text-like
files inside the zip (regex or literal), upload the modified zip back to
R2 under a content-hashed sibling key, then ask Shopify to install it
via REST ``POST /themes.json`` with a ``src`` URL — Shopify fetches and
extracts the zip server-side. Optionally publish (role=main) immediately.

Failure semantics:

* ``ShopifyAdminError`` mid-mutation → wrapped as :class:`ThemePushError`
  with ``theme create failed:`` prefix; route maps to 502.
* ``ShopifyCliError`` (no token) → wrapped as :class:`ThemePushError`
  with ``shopify CLI:`` prefix; route maps to 503.
* R2 download failure → wrapped as :class:`ThemePushError` with
  ``R2 get_object failed:`` prefix; route maps to 502.
* Dry-run skips R2 + Shopify entirely and returns synthetic ids so
  end-to-end work never blocks on missing creds.

Notes:

* ``replace_rules`` keys may begin with ``re:`` to apply Python regex
  substitution; otherwise the rule is a literal substring replace.
* Only text-like files (.liquid/.json/.css/.js/.txt/.md/.yaml/.yml) are
  scanned; binary entries are streamed through unchanged.
* If no rules are applied, the original R2 key is reused as the install
  source (no second upload).
"""
from __future__ import annotations

import hashlib
import io
import logging
import re
import time
import zipfile
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional

from app.clients.shopify_admin import ShopifyAdminClient, ShopifyAdminError
from app.clients.shopify_cli import ShopifyCliError

logger = logging.getLogger(__name__)


class ThemePushError(Exception):
    """Raised when the theme push pipeline fails fatally."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _theme_numeric_id(theme_id: Any) -> Optional[str]:
    """Extract numeric tail from a theme id (gid or raw)."""
    if theme_id is None:
        return None
    s = str(theme_id)
    if "/" in s:
        return s.rsplit("/", 1)[-1]
    return s


class ThemePushService:
    """Pull theme zip from R2 → apply replace rules → install via src URL."""

    # Files we apply replace rules to (text-like).
    _TEXT_EXTS = {
        ".liquid",
        ".json",
        ".css",
        ".js",
        ".txt",
        ".md",
        ".yaml",
        ".yml",
        ".html",
        ".svg",
    }

    def __init__(
        self,
        shopify_cli: Any,
        r2_client: Any,
        admin_factory: Callable[..., ShopifyAdminClient] = ShopifyAdminClient,
        dry_run: bool = False,
    ) -> None:
        self.shopify_cli = shopify_cli
        self.r2_client = r2_client
        self.admin_factory = admin_factory
        self.dry_run = dry_run

    # ----------------------------------------------------------------- public

    def push(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        source_zip_r2_key: str,
        replace_rules: Optional[Mapping[str, str]] = None,
        theme_name_prefix: str = "saga",
        publish: bool = False,
        access_token: Optional[str] = None,
    ) -> dict:
        if self.dry_run:
            return self._push_dry_run(
                task_id=task_id,
                source_zip_r2_key=source_zip_r2_key,
                replace_rules=replace_rules,
                publish=publish,
            )
        return self._push_real(
            shop_domain=shop_domain,
            tenant_id=tenant_id,
            store_id=store_id,
            task_id=task_id,
            source_zip_r2_key=source_zip_r2_key,
            replace_rules=replace_rules,
            theme_name_prefix=theme_name_prefix or "saga",
            publish=publish,
            access_token=access_token,
        )

    # ------------------------------------------------------------------ modes

    def _push_real(
        self,
        shop_domain: str,
        tenant_id: int,
        store_id: int,
        task_id: int,
        source_zip_r2_key: str,
        replace_rules: Optional[Mapping[str, str]],
        theme_name_prefix: str,
        publish: bool,
        access_token: Optional[str],
    ) -> dict:
        started_at = _now_iso()
        clock_start = time.perf_counter()

        # 1) Download zip from R2.
        if self.r2_client is None:
            raise ThemePushError("ThemePushService requires r2_client")
        try:
            zip_bytes, _ = self.r2_client.get_object(source_zip_r2_key)
        except Exception as exc:  # noqa: BLE001
            raise ThemePushError(
                f"R2 get_object failed for {source_zip_r2_key}: {exc}"
            ) from exc

        # 2) Apply replace rules if any.
        rules_applied_count = 0
        modified_bytes = zip_bytes
        if replace_rules:
            modified_bytes, rules_applied_count = self._apply_rules(
                zip_bytes, replace_rules
            )

        # 3) Upload modified zip to R2 under a content-hashed sibling key
        #    only when something actually changed; else reuse original key.
        if rules_applied_count > 0:
            sha = hashlib.sha256(modified_bytes).hexdigest()
            modified_key = self._modified_key(source_zip_r2_key, sha)
            try:
                self.r2_client.put_object(
                    modified_key, modified_bytes, "application/zip"
                )
            except Exception as exc:  # noqa: BLE001
                raise ThemePushError(
                    f"R2 put_object failed for {modified_key}: {exc}"
                ) from exc
        else:
            modified_key = source_zip_r2_key
            sha = hashlib.sha256(zip_bytes).hexdigest()

        # 4) Build a public URL Shopify can fetch.
        from app.config import settings

        if settings.r2_public_base:
            src_url = f"{settings.r2_public_base.rstrip('/')}/{modified_key}"
        else:
            # Fallback: direct endpoint URL (works for MinIO dev with public
            # bucket; not for production R2 unless lifecycle rules expose it).
            src_url = (
                f"{settings.r2_endpoint.rstrip('/')}/"
                f"{settings.r2_bucket}/{modified_key}"
            )

        # 5) Resolve Shopify token. custom_app stores supply directly.
        if access_token:
            token = access_token
        else:
            try:
                token = self.shopify_cli.get_token(shop_domain)
            except ShopifyCliError:
                raise
            except Exception as exc:  # noqa: BLE001
                raise ThemePushError(f"shopify CLI: {exc}") from exc

        admin = self.admin_factory(shop_domain, token)

        # 6) Create theme via src URL (role=unpublished initially).
        theme_name = f"{theme_name_prefix}-{int(time.time())}"
        try:
            created = admin.theme_create_from_src(
                theme_name, src_url, role="unpublished"
            )
        except ShopifyAdminError as exc:
            raise ThemePushError(f"theme create failed: {exc}") from exc

        theme_id = created.get("id")
        if theme_id is None:
            raise ThemePushError("theme create failed: response missing 'id'")
        numeric = _theme_numeric_id(theme_id)

        # 7) Optionally publish (role=main). Failure here is non-fatal —
        #    the theme is installed and can be published manually later.
        role = created.get("role") or "unpublished"
        if publish:
            try:
                published = admin.theme_publish(numeric or theme_id)
                role = published.get("role") or "main"
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[theme] publish failed (theme stays unpublished) "
                    "shop=%s task=%s theme=%s: %s",
                    shop_domain,
                    task_id,
                    theme_id,
                    exc,
                )

        elapsed = round(time.perf_counter() - clock_start, 3)
        logger.info(
            "[theme] pushed shop=%s task=%s theme=%s role=%s "
            "rules_applied=%d zip_bytes=%d elapsed=%ss",
            shop_domain,
            task_id,
            theme_id,
            role,
            rules_applied_count,
            len(modified_bytes),
            elapsed,
        )

        return {
            "task_id": task_id,
            "shopify_theme_id": str(theme_id),
            "shopify_theme_role": role,
            "shopify_theme_name": theme_name,
            "src_url": src_url,
            "modified_zip_r2_key": modified_key,
            "modified_zip_bytes": len(modified_bytes),
            "modified_zip_sha256": sha,
            "rules_applied_count": rules_applied_count,
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": False,
        }

    def _push_dry_run(
        self,
        task_id: int,
        source_zip_r2_key: str,
        replace_rules: Optional[Mapping[str, str]],
        publish: bool,
    ) -> dict:
        started_at = _now_iso()
        rules = dict(replace_rules or {})
        synthetic_id = f"99{int(time.time()) % 10**8}"
        modified_key = (
            f"{source_zip_r2_key}.modified-dryrun.zip" if rules else source_zip_r2_key
        )
        return {
            "task_id": task_id,
            "shopify_theme_id": synthetic_id,
            "shopify_theme_role": "main" if publish else "unpublished",
            "shopify_theme_name": f"saga-dryrun-{synthetic_id}",
            "src_url": f"https://dry-run.local/{modified_key}",
            "modified_zip_r2_key": modified_key,
            "modified_zip_bytes": 12345,
            "modified_zip_sha256": "deadbeef" * 8,
            "rules_applied_count": len(rules),
            "started_at": started_at,
            "completed_at": _now_iso(),
            "dry_run": True,
        }

    # ----------------------------------------------------------------- helpers

    @staticmethod
    def _modified_key(source_key: str, sha: str) -> str:
        """Build a sibling key for the modified zip.

        Strips a trailing ``.zip`` (case-insensitive) so the new suffix
        sits before the extension, e.g. ``a/b.zip`` →
        ``a/b.modified-<sha8>.zip``. Keys without ``.zip`` get the suffix
        appended verbatim.
        """
        short = sha[:8]
        if source_key.lower().endswith(".zip"):
            stem = source_key[:-4]
            return f"{stem}.modified-{short}.zip"
        return f"{source_key}.modified-{short}.zip"

    @classmethod
    def _apply_rules(
        cls,
        zip_bytes: bytes,
        rules: Mapping[str, str],
    ) -> tuple[bytes, int]:
        """Open zip, apply rules to text entries, repack.

        Returns ``(new_zip_bytes, files_modified_count)``. Binary entries
        and entries that can't be UTF-8 decoded pass through unchanged.
        """
        if not rules:
            return zip_bytes, 0

        in_buf = io.BytesIO(zip_bytes)
        out_buf = io.BytesIO()
        applied = 0
        try:
            with zipfile.ZipFile(in_buf, "r") as src, zipfile.ZipFile(
                out_buf, "w", zipfile.ZIP_DEFLATED
            ) as dst:
                for info in src.infolist():
                    data = src.read(info.filename)
                    name_lower = info.filename.lower()
                    ext = ""
                    if "." in name_lower:
                        ext = "." + name_lower.rsplit(".", 1)[-1]
                    if not info.is_dir() and ext in cls._TEXT_EXTS:
                        try:
                            text = data.decode("utf-8")
                        except UnicodeDecodeError:
                            # Binary/non-UTF-8; pass through unchanged.
                            dst.writestr(info, data)
                            continue
                        original = text
                        for pattern, replacement in rules.items():
                            if pattern is None:
                                continue
                            repl = "" if replacement is None else replacement
                            if pattern.startswith("re:"):
                                try:
                                    text = re.sub(pattern[3:], repl, text)
                                except re.error as e:
                                    logger.warning(
                                        "[theme] bad regex rule %r: %s",
                                        pattern,
                                        e,
                                    )
                            else:
                                if pattern == "":
                                    continue
                                text = text.replace(pattern, repl)
                        if text != original:
                            applied += 1
                            data = text.encode("utf-8")
                    dst.writestr(info, data)
        except zipfile.BadZipFile as exc:
            raise ThemePushError(f"source zip is not a valid zip: {exc}") from exc
        return out_buf.getvalue(), applied
