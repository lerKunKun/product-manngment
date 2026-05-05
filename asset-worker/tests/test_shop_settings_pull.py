"""Tests for ShopSettingsPullService orchestration (CAS-backed, AS3)."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from app.services.shop_settings_pull import ShopSettingsPullService


SHOP = "demo.myshopify.com"


def _r2_with_miss():
    r2 = MagicMock()
    r2.head_object.return_value = False
    return r2


class _FakeAdmin:
    """Fake admin client that captures REST GET calls and returns canned graphql data."""

    def __init__(
        self,
        rest_responses: dict[str, dict] | None = None,
        markets_data: dict | None = None,
    ) -> None:
        self.rest_responses = rest_responses or {}
        self.markets_data = markets_data or {}
        self.calls: list[tuple] = []

    def _get(self, path: str, params: dict | None = None):
        self.calls.append(("rest_get", path))
        return self.rest_responses.get(path, {})

    def graphql(self, query: str, variables: dict | None = None):
        self.calls.append(("graphql",))
        return self.markets_data


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


# ----------------------------------------------------------------------- tests


def test_dry_run_returns_one_synthetic_settings_doc():
    cli = MagicMock()
    r2 = _r2_with_miss()

    svc = ShopSettingsPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    assert out["dry_run"] is True
    assert out["file_count"] == 1
    assert out["r2_prefix"] == "tenants/1/stores/3/snapshots/42/shop_settings/"
    assert out["manifest_key"].endswith("manifest.json")
    cli.get_token.assert_not_called()
    # 1 CAS PUT + 1 manifest = 2.
    assert r2.put_object.call_count == 2

    cas_call = r2.put_object.call_args_list[0]
    body = json.loads(cas_call.args[1].decode("utf-8"))
    assert "shop" in body and body["shop"]["name"] == "Dry Run Shop"
    assert isinstance(body["locations"], list)
    assert isinstance(body["shipping_zones"], list)
    assert isinstance(body["markets"], list)


def test_real_path_aggregates_rest_and_graphql():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(
        rest_responses={
            "/shop.json": {"shop": {"id": 1, "name": "Live Store"}},
            "/locations.json": {
                "locations": [{"id": 101, "name": "Main"}, {"id": 102, "name": "POP"}]
            },
            "/shipping_zones.json": {
                "shipping_zones": [{"id": 201, "name": "Default"}]
            },
        },
        markets_data={
            "markets": {
                "nodes": [
                    {
                        "id": "gid://shopify/Market/1",
                        "name": "United States",
                        "primary": True,
                    }
                ]
            }
        },
    )

    svc = ShopSettingsPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    cli.get_token.assert_called_once_with(SHOP)
    # 3 REST gets + 1 graphql call expected.
    rest_paths = [c[1] for c in fake.calls if c[0] == "rest_get"]
    assert "/shop.json" in rest_paths
    assert "/locations.json" in rest_paths
    assert "/shipping_zones.json" in rest_paths
    assert any(c[0] == "graphql" for c in fake.calls)

    assert out["file_count"] == 1
    # 1 CAS PUT + 1 manifest
    assert r2.put_object.call_count == 2
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[0].startswith("tenants/1/cas/")
    assert keys[-1].endswith("manifest.json")

    cas_call = r2.put_object.call_args_list[0]
    document = json.loads(cas_call.args[1].decode("utf-8"))
    assert document["shop"]["name"] == "Live Store"
    assert len(document["locations"]) == 2
    assert document["shipping_zones"] == [{"id": 201, "name": "Default"}]
    assert document["markets"][0]["primary"] is True


def test_empty_responses_still_produce_valid_document():
    """If Shopify returns nothing, we still ship a well-formed manifest entry."""
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(
        rest_responses={
            "/shop.json": {"shop": None},
            "/locations.json": {"locations": []},
            "/shipping_zones.json": {"shipping_zones": []},
        },
        markets_data={"markets": {"nodes": []}},
    )

    svc = ShopSettingsPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    assert out["file_count"] == 1
    assert out["total_bytes"] > 0
    # 1 CAS PUT + 1 manifest
    assert r2.put_object.call_count == 2

    cas_call = r2.put_object.call_args_list[0]
    document = json.loads(cas_call.args[1].decode("utf-8"))
    assert document["shop"] is None
    assert document["locations"] == []
    assert document["shipping_zones"] == []
    assert document["markets"] == []
