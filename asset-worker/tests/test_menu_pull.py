"""Tests for MenuPullService orchestration."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from app.services.menu_pull import MenuPullService


SHOP = "demo.myshopify.com"


class _FakeAdmin:
    def __init__(self, menus: list[dict] | None = None) -> None:
        self.menus = menus if menus is not None else []
        self.calls: list[tuple] = []

    def get_menus(self) -> list[dict]:
        # MenuPullService MUST use get_menus (which internally uses graphql).
        self.calls.append(("get_menus",))
        return self.menus


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


def test_dry_run_returns_one_menu():
    cli = MagicMock()
    r2 = MagicMock()

    svc = MenuPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    assert out["dry_run"] is True
    assert out["file_count"] == 1
    assert out["r2_prefix"] == "tenants/1/stores/3/snapshots/42/menu/"
    cli.get_token.assert_not_called()
    # 1 menu file + 1 manifest = 2 put_object calls in dry-run.
    assert r2.put_object.call_count == 2
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[-1].endswith("manifest.json")


def test_dry_run_swallows_r2_errors():
    cli = MagicMock()
    r2 = MagicMock()
    r2.put_object.side_effect = RuntimeError("R2 not configured")

    svc = MenuPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)
    assert out["dry_run"] is True
    assert out["file_count"] == 1
    assert r2.put_object.call_count == 2


def test_real_path_uses_get_menus():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()

    fake = _FakeAdmin(
        menus=[
            {
                "id": "gid://shopify/Menu/1",
                "handle": "main-menu",
                "title": "Main",
                "items": [
                    {"title": "Home", "url": "/", "type": "FRONTPAGE"},
                    {"title": "Shop", "url": "/c/all", "type": "COLLECTION"},
                ],
            },
            {
                "id": "gid://shopify/Menu/2",
                "handle": "footer",
                "title": "Footer",
                "items": [],
            },
        ]
    )
    svc = MenuPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    # The service must have asked for menus (no REST fallback).
    assert ("get_menus",) in fake.calls
    assert out["file_count"] == 2
    # 2 menu files + 1 manifest.
    assert r2.put_object.call_count == 3
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[-1].endswith("manifest.json")
    assert any(k.endswith("main-menu.json") for k in keys[:-1])
    assert any(k.endswith("footer.json") for k in keys[:-1])

    manifest = json.loads(r2.put_object.call_args_list[-1].args[1].decode("utf-8"))
    assert manifest["kind"] == "menu"
    main_entry = next(f for f in manifest["files"] if f["handle"] == "main-menu")
    assert main_entry["item_count"] == 2


def test_empty_menus_yields_valid_empty_manifest():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()

    fake = _FakeAdmin(menus=[])
    svc = MenuPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=99)

    assert out["file_count"] == 0
    assert out["total_bytes"] == 0
    # Only the manifest is written.
    assert r2.put_object.call_count == 1
    manifest_call = r2.put_object.call_args_list[-1]
    assert manifest_call.args[0].endswith("manifest.json")
    manifest = json.loads(manifest_call.args[1].decode("utf-8"))
    assert manifest["files"] == []
    assert manifest["summary"]["file_count"] == 0
    assert manifest["summary"]["total_bytes"] == 0
