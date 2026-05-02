"""Tests for CollectionPullService orchestration."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from app.services.collection_pull import CollectionPullService


SHOP = "demo.myshopify.com"


class _FakeAdmin:
    def __init__(
        self,
        custom: list[dict] | None = None,
        smart: list[dict] | None = None,
    ) -> None:
        self.custom = custom or []
        self.smart = smart or []
        self.calls: list[tuple] = []

    def get_custom_collections(self) -> list[dict]:
        self.calls.append(("get_custom_collections",))
        return self.custom

    def get_smart_collections(self) -> list[dict]:
        self.calls.append(("get_smart_collections",))
        return self.smart


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


def test_dry_run_returns_two_collections():
    cli = MagicMock()
    r2 = MagicMock()

    svc = CollectionPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    assert out["dry_run"] is True
    assert out["file_count"] == 2
    assert out["r2_prefix"] == "tenants/1/stores/3/snapshots/42/collection/"
    cli.get_token.assert_not_called()
    # 2 collection files + 1 index.json + 1 manifest = 4 put_object calls.
    assert r2.put_object.call_count == 4
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[-1].endswith("manifest.json")
    assert any(k.endswith("index.json") for k in keys)


def test_dry_run_swallows_r2_errors():
    cli = MagicMock()
    r2 = MagicMock()
    r2.put_object.side_effect = RuntimeError("R2 not configured")

    svc = CollectionPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)
    assert out["dry_run"] is True
    assert out["file_count"] == 2
    assert r2.put_object.call_count == 4


def test_real_path_combines_custom_and_smart():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()

    fake = _FakeAdmin(
        custom=[
            {"id": 11, "handle": "frontpage", "title": "Frontpage"},
            {"id": 12, "handle": "sale", "title": "Sale"},
        ],
        smart=[
            {"id": 21, "handle": "best-sellers", "title": "Best Sellers"},
        ],
    )
    svc = CollectionPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    # Both endpoints called once.
    assert ("get_custom_collections",) in fake.calls
    assert ("get_smart_collections",) in fake.calls

    # 3 collection files + 1 index.json + 1 manifest = 5 put_object calls.
    assert r2.put_object.call_count == 5
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[-1].endswith("manifest.json")
    assert any(k.endswith("custom-frontpage.json") for k in keys)
    assert any(k.endswith("custom-sale.json") for k in keys)
    assert any(k.endswith("smart-best-sellers.json") for k in keys)
    assert any(k.endswith("index.json") for k in keys)

    manifest = json.loads(r2.put_object.call_args_list[-1].args[1].decode("utf-8"))
    assert manifest["kind"] == "collection"
    assert manifest["summary"]["custom_count"] == 2
    assert manifest["summary"]["smart_count"] == 1
    # file_count counts every uploaded artifact incl. index.json.
    assert manifest["summary"]["file_count"] == 4
    assert out["file_count"] == 4


def test_each_collection_gets_separate_r2_key():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()

    fake = _FakeAdmin(
        custom=[{"id": 1, "handle": "alpha", "title": "Alpha"}],
        smart=[{"id": 2, "handle": "alpha", "title": "Alpha (smart)"}],
    )
    svc = CollectionPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    keys = [c.args[0] for c in r2.put_object.call_args_list]
    # Same handle in both flavours must NOT collide (custom-/smart- prefix).
    assert any(k.endswith("custom-alpha.json") for k in keys)
    assert any(k.endswith("smart-alpha.json") for k in keys)
    # Sanity: every key (excluding manifest+index) is unique.
    body_keys = [
        k for k in keys if not (k.endswith("manifest.json") or k.endswith("index.json"))
    ]
    assert len(body_keys) == len(set(body_keys))
