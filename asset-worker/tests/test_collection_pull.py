"""Tests for CollectionPullService orchestration (CAS-backed, AS2)."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from app.services.collection_pull import CollectionPullService


SHOP = "demo.myshopify.com"


def _r2_with_miss():
    r2 = MagicMock()
    r2.head_object.return_value = False
    return r2


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


def test_dry_run_returns_three_entries():
    cli = MagicMock()
    r2 = _r2_with_miss()

    svc = CollectionPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    assert out["dry_run"] is True
    # 2 collections + 1 index.json
    assert out["file_count"] == 3
    assert out["r2_prefix"] == "tenants/1/stores/3/snapshots/42/collection/"
    cli.get_token.assert_not_called()
    # 2 collections + 1 index.json (CAS) + 1 manifest = 4 put_object calls
    assert r2.put_object.call_count == 4
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[-1].endswith("manifest.json")


def test_dry_run_swallows_r2_errors():
    cli = MagicMock()
    r2 = _r2_with_miss()
    r2.head_object.side_effect = RuntimeError("R2 not configured")
    r2.put_object.side_effect = RuntimeError("R2 not configured")

    svc = CollectionPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)
    assert out["dry_run"] is True
    assert out["file_count"] == 3


def test_real_path_combines_custom_and_smart():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

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

    assert ("get_custom_collections",) in fake.calls
    assert ("get_smart_collections",) in fake.calls

    # 3 collections + 1 index.json (all CAS) + 1 manifest = 5 put_object calls
    assert r2.put_object.call_count == 5
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[-1].endswith("manifest.json")
    # Pre-manifest keys all live under tenant CAS prefix.
    for k in keys[:-1]:
        assert k.startswith("tenants/1/cas/")

    manifest = json.loads(r2.put_object.call_args_list[-1].args[1].decode("utf-8"))
    paths = sorted(e["relative_path"] for e in manifest["entries"])
    assert paths == [
        "custom-frontpage.json",
        "custom-sale.json",
        "index.json",
        "smart-best-sellers.json",
    ]
    # entries count includes index.json
    assert out["file_count"] == 4


def test_dedup_when_same_collection_repeats():
    """Two pulls of identical collection content → second pull dedups
    on every CAS HEAD hit (only manifest is PUT)."""
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()
    r2.head_object.return_value = True  # CAS hit

    fake = _FakeAdmin(
        custom=[{"id": 1, "handle": "frontpage", "title": "F"}],
        smart=[],
    )
    svc = CollectionPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    # 1 collection + 1 index.json — both deduped.
    assert out["deduped_count"] == 2
    assert r2.put_object.call_count == 1  # only manifest
    assert r2.put_object.call_args_list[0].args[0].endswith("manifest.json")
