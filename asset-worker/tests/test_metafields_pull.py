"""Tests for MetafieldsPullService orchestration (CAS-backed, AS3)."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from app.services.metafields_pull import MetafieldsPullService


SHOP = "demo.myshopify.com"


def _r2_with_miss():
    r2 = MagicMock()
    r2.head_object.return_value = False
    return r2


class _FakeAdmin:
    """Routes graphql calls by the query keyword so paginated tests remain deterministic."""

    def __init__(
        self,
        definition_pages: list[dict] | None = None,
        instance_pages: list[dict] | None = None,
    ) -> None:
        self.definition_pages = list(definition_pages or [])
        self.instance_pages = list(instance_pages or [])
        self.calls: list[tuple] = []

    def graphql(self, query: str, variables: dict | None = None):
        self.calls.append(("graphql", query, variables or {}))
        if "metafieldDefinitions" in query:
            if self.definition_pages:
                return self.definition_pages.pop(0)
            return {
                "metafieldDefinitions": {
                    "pageInfo": {"hasNextPage": False},
                    "nodes": [],
                }
            }
        if "shop" in query and "metafields" in query:
            if self.instance_pages:
                return self.instance_pages.pop(0)
            return {
                "shop": {
                    "metafields": {
                        "pageInfo": {"hasNextPage": False},
                        "nodes": [],
                    }
                }
            }
        return {}


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


# ----------------------------------------------------------------------- tests


def test_dry_run_returns_synthetic_metafields():
    cli = MagicMock()
    r2 = _r2_with_miss()

    svc = MetafieldsPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    assert out["dry_run"] is True
    assert out["file_count"] == 1
    assert out["r2_prefix"] == "tenants/1/stores/3/snapshots/42/metafields/"
    assert out["manifest_key"].endswith("manifest.json")
    cli.get_token.assert_not_called()
    # 1 CAS PUT + 1 manifest
    assert r2.put_object.call_count == 2

    cas_call = r2.put_object.call_args_list[0]
    body = json.loads(cas_call.args[1].decode("utf-8"))
    assert body["owner_type"] == "SHOP"
    assert len(body["definitions"]) == 1
    assert len(body["metafields"]) == 1


def test_real_path_aggregates_definitions_and_instances():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(
        definition_pages=[
            {
                "metafieldDefinitions": {
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                    "nodes": [
                        {
                            "id": "gid://shopify/MetafieldDefinition/1",
                            "namespace": "custom",
                            "key": "company_motto",
                            "name": "Company motto",
                            "type": {"name": "single_line_text_field"},
                            "ownerType": "SHOP",
                        }
                    ],
                }
            }
        ],
        instance_pages=[
            {
                "shop": {
                    "metafields": {
                        "pageInfo": {"hasNextPage": False, "endCursor": None},
                        "nodes": [
                            {
                                "id": "gid://shopify/Metafield/1001",
                                "namespace": "custom",
                                "key": "company_motto",
                                "type": "single_line_text_field",
                                "value": "Stay weird.",
                            }
                        ],
                    }
                }
            }
        ],
    )

    svc = MetafieldsPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    cli.get_token.assert_called_once_with(SHOP)
    # Two graphql calls: one for definitions, one for shop.metafields.
    queries = [c[1] for c in fake.calls if c[0] == "graphql"]
    assert any("metafieldDefinitions" in q for q in queries)
    assert any("metafields" in q and "shop" in q for q in queries)

    assert out["file_count"] == 1
    assert r2.put_object.call_count == 2
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[0].startswith("tenants/1/cas/")
    assert keys[-1].endswith("manifest.json")

    cas_call = r2.put_object.call_args_list[0]
    document = json.loads(cas_call.args[1].decode("utf-8"))
    assert document["owner_type"] == "SHOP"
    assert document["definitions"][0]["key"] == "company_motto"
    assert document["metafields"][0]["value"] == "Stay weird."


def test_empty_metafields_yields_valid_empty_document():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(
        definition_pages=[
            {"metafieldDefinitions": {"pageInfo": {"hasNextPage": False}, "nodes": []}}
        ],
        instance_pages=[
            {
                "shop": {
                    "metafields": {
                        "pageInfo": {"hasNextPage": False},
                        "nodes": [],
                    }
                }
            }
        ],
    )

    svc = MetafieldsPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    assert out["file_count"] == 1
    # 1 CAS put (empty doc, but still bytes) + manifest
    assert r2.put_object.call_count == 2

    cas_call = r2.put_object.call_args_list[0]
    document = json.loads(cas_call.args[1].decode("utf-8"))
    assert document["definitions"] == []
    assert document["metafields"] == []
