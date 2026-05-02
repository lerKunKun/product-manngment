"""Tests for ThemePushService — saga THEME step (W3-NEW-06 + W3-NEW-07)."""
from __future__ import annotations

import io
import zipfile
from unittest.mock import MagicMock

import pytest

from app.services.theme_push import ThemePushError, ThemePushService


SHOP = "demo.myshopify.com"


# ----------------------------------------------------------------- fakes


class _FakeAdmin:
    def __init__(
        self,
        create_resp: dict | None = None,
        publish_resp: dict | None = None,
        create_exc: Exception | None = None,
        publish_exc: Exception | None = None,
    ) -> None:
        self.create_resp = create_resp or {
            "id": 145678901,
            "name": "saga-test",
            "role": "unpublished",
            "processing": True,
        }
        self.publish_resp = publish_resp or {
            "id": 145678901,
            "name": "saga-test",
            "role": "main",
        }
        self.create_exc = create_exc
        self.publish_exc = publish_exc
        self.calls: list[tuple] = []
        self.constructed_with: tuple | None = None

    def theme_create_from_src(self, name: str, src_url: str, role: str = "unpublished") -> dict:
        self.calls.append(("theme_create_from_src", name, src_url, role))
        if self.create_exc is not None:
            raise self.create_exc
        return self.create_resp

    def theme_publish(self, theme_id) -> dict:
        self.calls.append(("theme_publish", theme_id))
        if self.publish_exc is not None:
            raise self.publish_exc
        return self.publish_resp


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


def _make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return buf.getvalue()


def _read_zip(zip_bytes: bytes) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as z:
        for n in z.namelist():
            out[n] = z.read(n)
    return out


# ------------------------------------------------------------------ tests


def test_dry_run_returns_synthetic():
    cli = MagicMock()
    r2 = MagicMock()
    svc = ThemePushService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=99,
        source_zip_r2_key="templates/1/v1/theme.zip",
        replace_rules={"BIOU": "ACME"},
        publish=False,
    )

    assert out["dry_run"] is True
    assert out["task_id"] == 99
    assert out["shopify_theme_id"]
    assert out["shopify_theme_role"] == "unpublished"
    assert out["rules_applied_count"] == 1
    # Neither R2 nor Shopify were touched.
    cli.get_token.assert_not_called()
    r2.get_object.assert_not_called()
    r2.put_object.assert_not_called()


def test_apply_rules_changes_text_files():
    src_zip = _make_zip(
        {
            "templates/index.liquid": b"Welcome to BIOU store",
            "config/settings_data.json": b'{"brand":"BIOU"}',
            "assets/logo.png": b"\x89PNG\r\n\x1a\nbinarybytes",
        }
    )
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()
    r2.get_object.return_value = (src_zip, "application/zip")
    fake = _FakeAdmin()
    svc = ThemePushService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=11,
        source_zip_r2_key="templates/1/v1/theme.zip",
        replace_rules={"BIOU": "ACME"},
    )

    # 2 text files modified (liquid + json); png untouched.
    assert out["rules_applied_count"] == 2
    # New zip uploaded under sibling key.
    assert r2.put_object.call_count == 1
    put_args, put_kwargs = r2.put_object.call_args
    modified_key = put_args[0]
    modified_bytes = put_args[1]
    assert modified_key.endswith(".zip")
    assert modified_key != "templates/1/v1/theme.zip"
    assert ".modified-" in modified_key
    # Verify the modified zip contains the substituted text.
    entries = _read_zip(modified_bytes)
    assert b"ACME" in entries["templates/index.liquid"]
    assert b"BIOU" not in entries["templates/index.liquid"]
    assert b"ACME" in entries["config/settings_data.json"]
    # Binary file is preserved byte-for-byte.
    assert entries["assets/logo.png"].startswith(b"\x89PNG")
    # Theme creation invoked with the public src URL.
    assert any(c[0] == "theme_create_from_src" for c in fake.calls)
    assert out["shopify_theme_id"] == "145678901"
    assert out["dry_run"] is False


def test_regex_rule_applies():
    src_zip = _make_zip({"snippets/foo.liquid": b"contact: support@biou.example.com"})
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()
    r2.get_object.return_value = (src_zip, "application/zip")
    fake = _FakeAdmin()
    svc = ThemePushService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=12,
        source_zip_r2_key="templates/1/v1/theme.zip",
        replace_rules={"re:[a-z]+@biou\\.example\\.com": "hello@acme.example.com"},
    )

    assert out["rules_applied_count"] == 1
    modified_bytes = r2.put_object.call_args[0][1]
    entries = _read_zip(modified_bytes)
    assert b"hello@acme.example.com" in entries["snippets/foo.liquid"]
    assert b"support@biou.example.com" not in entries["snippets/foo.liquid"]


def test_no_rules_passthrough_reuses_source_key():
    src_zip = _make_zip({"templates/index.liquid": b"hello"})
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()
    r2.get_object.return_value = (src_zip, "application/zip")
    fake = _FakeAdmin()
    svc = ThemePushService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=13,
        source_zip_r2_key="templates/1/v1/theme.zip",
        replace_rules=None,
    )

    # No rules → no second R2 upload, original key reused.
    r2.put_object.assert_not_called()
    assert out["modified_zip_r2_key"] == "templates/1/v1/theme.zip"
    assert out["rules_applied_count"] == 0
    # Theme still installed.
    assert any(c[0] == "theme_create_from_src" for c in fake.calls)
    assert out["shopify_theme_id"] == "145678901"


def test_admin_error_propagates_as_theme_push_error():
    from app.clients.shopify_admin import ShopifyAdminError

    src_zip = _make_zip({"templates/index.liquid": b"hello"})
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()
    r2.get_object.return_value = (src_zip, "application/zip")
    fake = _FakeAdmin(create_exc=ShopifyAdminError("themes.json returned 422: {...}"))
    svc = ThemePushService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    with pytest.raises(ThemePushError, match="theme create failed"):
        svc.push(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=3,
            task_id=14,
            source_zip_r2_key="templates/1/v1/theme.zip",
            replace_rules={"BIOU": "ACME"},
        )


def test_publish_calls_theme_publish_when_flag_set():
    src_zip = _make_zip({"templates/index.liquid": b"hello"})
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()
    r2.get_object.return_value = (src_zip, "application/zip")
    fake = _FakeAdmin()
    svc = ThemePushService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=15,
        source_zip_r2_key="templates/1/v1/theme.zip",
        replace_rules=None,
        publish=True,
    )

    assert any(c[0] == "theme_publish" for c in fake.calls)
    assert out["shopify_theme_role"] == "main"
