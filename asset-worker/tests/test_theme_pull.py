"""Tests for ThemePullService orchestration (CAS-backed, AS2)."""
from __future__ import annotations

import base64
import hashlib
import json
from unittest.mock import MagicMock

import pytest

from app.clients.shopify_admin import ShopifyAdminError
from app.services.theme_pull import ThemePullService


SHOP = "demo.myshopify.com"


def _r2_with_miss():
    """A MagicMock R2 client whose head_object always reports a CAS miss.

    With ``head_object.return_value = False`` every blob in a given test
    will be uploaded (no dedup), matching pre-CAS expectations of "one
    put_object per file + one for manifest".
    """
    r2 = MagicMock()
    r2.head_object.return_value = False
    return r2


# --------------------------------------------------------------------- helpers


class _FakeAdmin:
    def __init__(
        self,
        themes: list[dict] | None = None,
        assets_meta: list[dict] | None = None,
        asset_bodies: dict[str, dict] | None = None,
        get_assets_error: Exception | None = None,
    ) -> None:
        self.themes = themes or []
        self.assets_meta = assets_meta or []
        self.asset_bodies = asset_bodies or {}
        self.get_assets_error = get_assets_error
        self.calls: list[tuple] = []

    def get_themes(self) -> list[dict]:
        self.calls.append(("get_themes",))
        return self.themes

    def get_assets(self, theme_id: int) -> list[dict]:
        self.calls.append(("get_assets", theme_id))
        if self.get_assets_error is not None:
            raise self.get_assets_error
        return self.assets_meta

    def get_asset(self, theme_id: int, key: str) -> dict:
        self.calls.append(("get_asset", theme_id, key))
        return self.asset_bodies[key]


def _admin_factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


# ----------------------------------------------------------------------- tests


def test_dry_run_returns_synthetic_manifest():
    cli = MagicMock()
    r2 = _r2_with_miss()

    svc = ThemePullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        snapshot_id=42,
    )

    assert out["file_count"] == 3
    assert out["snapshot_id"] == 42
    assert out["r2_prefix"] == "tenants/1/stores/3/snapshots/42/theme/"
    assert out["manifest_key"].endswith("manifest.json")
    assert out.get("dry_run") is True
    assert out["deduped_count"] == 0
    cli.get_token.assert_not_called()
    # 3 synthetic files via CAS + 1 manifest = 4 put_object calls.
    assert r2.put_object.call_count == 4
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    # CAS keys live under tenants/1/cas/
    cas_keys = [k for k in keys if "/cas/" in k]
    assert len(cas_keys) == 3
    assert keys[-1].endswith("manifest.json")


def test_dry_run_swallows_r2_errors():
    cli = MagicMock()
    r2 = _r2_with_miss()
    # Both HEAD and PUT fail — dry-run must still return a manifest.
    r2.head_object.side_effect = RuntimeError("R2 not configured")
    r2.put_object.side_effect = RuntimeError("R2 not configured")

    svc = ThemePullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        snapshot_id=42,
    )
    assert out["dry_run"] is True
    assert out["file_count"] == 3


def test_pull_main_theme_when_no_id_given():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(
        themes=[
            {"id": 111, "name": "Demo", "role": "demo"},
            {"id": 222, "name": "Live", "role": "main"},
        ],
        assets_meta=[],
        asset_bodies={},
    )

    svc = ThemePullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_admin_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        snapshot_id=42,
    )

    cli.get_token.assert_called_once_with(SHOP)
    assert fake.constructed_with == (SHOP, "shpat_test")
    assert ("get_assets", 222) in fake.calls
    assert out["file_count"] == 0
    # Only the manifest is written when there are no assets.
    assert r2.put_object.call_count == 1
    last_key = r2.put_object.call_args_list[-1].args[0]
    assert last_key.endswith("manifest.json")


def test_pull_writes_manifest_last_with_cas_keys():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    assets_meta = [
        {"key": "templates/index.json"},
        {"key": "assets/theme.css"},
        {"key": "assets/logo.png"},
    ]
    asset_bodies = {
        "templates/index.json": {
            "key": "templates/index.json",
            "value": '{"sections": {}}',
            "content_type": "application/json",
        },
        "assets/theme.css": {
            "key": "assets/theme.css",
            "value": "body{}",
            "content_type": "text/css",
        },
        "assets/logo.png": {
            "key": "assets/logo.png",
            "attachment": base64.b64encode(b"PNGDATA").decode("ascii"),
            "content_type": "image/png",
        },
    }
    fake = _FakeAdmin(
        themes=[{"id": 222, "name": "Live", "role": "main"}],
        assets_meta=assets_meta,
        asset_bodies=asset_bodies,
    )

    svc = ThemePullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_admin_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        snapshot_id=42,
    )

    assert out["file_count"] == 3
    # 3 CAS PUTs + 1 manifest PUT
    assert r2.put_object.call_count == len(assets_meta) + 1
    keys = [call.args[0] for call in r2.put_object.call_args_list]
    # All non-manifest keys should be under the tenant CAS prefix.
    for k in keys[:-1]:
        assert k.startswith("tenants/1/cas/")
    assert keys[-1].endswith("manifest.json")

    # Manifest content sanity check (CAS shape).
    manifest_call = r2.put_object.call_args_list[-1]
    manifest_bytes = manifest_call.args[1]
    manifest = json.loads(manifest_bytes.decode("utf-8"))
    assert manifest["version"] == 1
    assert "generated_at" in manifest
    entries = manifest["entries"]
    assert len(entries) == 3
    paths = sorted(e["relative_path"] for e in entries)
    assert paths == ["assets/logo.png", "assets/theme.css", "templates/index.json"]
    # Binary asset must have been base64-decoded — confirm via sha256.
    png_entry = next(e for e in entries if e["relative_path"] == "assets/logo.png")
    assert png_entry["sha256"] == hashlib.sha256(b"PNGDATA").hexdigest()
    assert png_entry["size"] == len(b"PNGDATA")


def test_pull_dedups_when_head_hits():
    """A CAS hit (head_object True) skips PUT; only manifest is written."""
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()
    r2.head_object.return_value = True  # everything is a hit

    asset_bodies = {
        "templates/index.json": {
            "key": "templates/index.json",
            "value": '{"sections": {}}',
            "content_type": "application/json",
        },
    }
    fake = _FakeAdmin(
        themes=[{"id": 222, "name": "Live", "role": "main"}],
        assets_meta=[{"key": "templates/index.json"}],
        asset_bodies=asset_bodies,
    )
    svc = ThemePullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_admin_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(SHOP, 1, 3, 42)

    assert out["file_count"] == 1
    assert out["deduped_count"] == 1
    # Only manifest is uploaded; the file body was deduped.
    assert r2.put_object.call_count == 1
    assert r2.put_object.call_args_list[0].args[0].endswith("manifest.json")


def test_admin_error_propagates():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(
        themes=[{"id": 222, "name": "Live", "role": "main"}],
        get_assets_error=ShopifyAdminError("boom: 500"),
    )

    svc = ThemePullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_admin_factory_for(fake),
        dry_run=False,
    )
    with pytest.raises(ShopifyAdminError) as excinfo:
        svc.pull(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=3,
            snapshot_id=42,
        )
    assert "boom" in str(excinfo.value)
    r2.put_object.assert_not_called()
