"""Tests for ThemePullService orchestration."""
from __future__ import annotations

import base64
import json
from unittest.mock import MagicMock

import pytest

from app.clients.shopify_admin import ShopifyAdminError
from app.services.theme_pull import ThemePullService


SHOP = "demo.myshopify.com"


# --------------------------------------------------------------------- helpers


class _FakeAdmin:
    """Pluggable stand-in for ShopifyAdminClient."""

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
        # capture into the fake for assertions
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


# ----------------------------------------------------------------------- tests


def test_dry_run_returns_synthetic_manifest():
    cli = MagicMock()
    r2 = MagicMock()

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
    # Shopify CLI must NOT be touched in dry-run.
    cli.get_token.assert_not_called()
    # But dry-run DOES upload to R2 now (so backend can fetch later).
    # 3 synthetic files + 1 manifest = 4 put_object calls.
    assert r2.put_object.call_count == 4
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[-1].endswith("manifest.json")


def test_dry_run_swallows_r2_errors():
    cli = MagicMock()
    r2 = MagicMock()
    r2.put_object.side_effect = RuntimeError("R2 not configured")

    svc = ThemePullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    # Should NOT raise; manifest comes back even when R2 is misconfigured.
    out = svc.pull(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        snapshot_id=42,
    )
    assert out["dry_run"] is True
    assert out["file_count"] == 3
    # Every put_object attempt was made; failure was swallowed.
    assert r2.put_object.call_count == 4


def test_pull_main_theme_when_no_id_given():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()

    fake = _FakeAdmin(
        themes=[
            {"id": 111, "name": "Demo", "role": "demo"},
            {"id": 222, "name": "Live", "role": "main"},
        ],
        assets_meta=[],  # no assets to keep test focused on theme picking
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

    # Token fetched + admin built with it.
    cli.get_token.assert_called_once_with(SHOP)
    assert fake.constructed_with == (SHOP, "shpat_test")
    # Theme picked = main (id=222), and get_assets called against it.
    assert ("get_assets", 222) in fake.calls
    assert out["file_count"] == 0
    # Manifest still uploaded.
    assert r2.put_object.call_count == 1
    last_key = r2.put_object.call_args_list[-1].args[0]
    assert last_key.endswith("manifest.json")


def test_pull_writes_manifest_last():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()

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
    # 3 asset bodies + 1 manifest = 4 put_object calls.
    assert r2.put_object.call_count == len(assets_meta) + 1
    keys = [call.args[0] for call in r2.put_object.call_args_list]
    assert keys[-1].endswith("manifest.json")
    # Earlier keys must NOT be the manifest.
    for k in keys[:-1]:
        assert not k.endswith("manifest.json")

    # Manifest content sanity check.
    manifest_call = r2.put_object.call_args_list[-1]
    manifest_bytes = manifest_call.args[1]
    manifest = json.loads(manifest_bytes.decode("utf-8"))
    assert manifest["snapshot_id"] == 42
    assert manifest["theme_id"] == 222
    assert manifest["theme_role"] == "main"
    assert len(manifest["files"]) == 3
    assert manifest["summary"]["file_count"] == 3
    assert manifest["summary"]["total_bytes"] == out["total_bytes"]
    # Binary asset must have been base64-decoded.
    png_entry = next(f for f in manifest["files"] if f["path"] == "assets/logo.png")
    assert png_entry["size"] == len(b"PNGDATA")


def test_admin_error_propagates():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()

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
    # No R2 writes should have happened — error surfaced before manifest.
    r2.put_object.assert_not_called()
