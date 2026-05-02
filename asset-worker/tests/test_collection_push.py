"""Tests for CollectionPushService — saga COLLECTIONS step relay."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.clients.shopify_admin import ShopifyAdminError
from app.clients.shopify_cli import ShopifyCliError
from app.services.collection_push import CollectionPushService


SHOP = "demo.myshopify.com"


class _FakeAdmin:
    """Fake admin that returns prefab responses keyed by call order."""

    def __init__(self, responses: list[dict | Exception] | None = None) -> None:
        self.responses: list[dict | Exception] = list(responses or [])
        self.calls: list[tuple] = []
        self.constructed_with: tuple | None = None

    def create_custom_collection(self, payload: dict) -> dict:
        self.calls.append(("create_custom_collection", payload))
        if not self.responses:
            return {"id": 999, "handle": payload.get("handle"), "title": payload.get("title")}
        nxt = self.responses.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


# ----------------------------------------------------------------------- tests


def test_dry_run_returns_synthetic_ids():
    cli = MagicMock()

    svc = CollectionPushService(shopify_cli=cli, dry_run=True)
    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=99,
        collections=[
            {"handle": "all", "title": "All Products"},
            {"handle": "new", "title": "New Arrivals"},
        ],
    )

    assert out["dry_run"] is True
    assert out["task_id"] == 99
    assert len(out["collections"]) == 2
    assert out["collections"][0]["shopify_id"].startswith("gid://shopify/Collection/")
    assert out["collections"][0]["handle"] == "all"
    assert out["collections"][1]["handle"] == "new"
    cli.get_token.assert_not_called()


def test_real_path_creates_each_collection():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdmin(
        responses=[
            {"id": 111, "handle": "all", "title": "All Products"},
            {"id": 222, "handle": "new-1", "title": "New Arrivals"},  # Shopify renamed handle
        ]
    )
    svc = CollectionPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=11,
        collections=[
            {"handle": "all", "title": "All Products"},
            {"handle": "new", "title": "New Arrivals"},
        ],
    )

    cli.get_token.assert_called_once_with(SHOP)
    assert fake.constructed_with == (SHOP, "shpat_test")
    assert len(fake.calls) == 2

    assert out["dry_run"] is False
    assert out["task_id"] == 11
    assert len(out["collections"]) == 2
    assert out["collections"][0]["shopify_id"] == "gid://shopify/Collection/111"
    assert out["collections"][0]["handle"] == "all"
    assert out["collections"][1]["shopify_id"] == "gid://shopify/Collection/222"
    assert out["collections"][1]["handle"] == "new-1"  # rename surfaced
    assert "error" not in out["collections"][0]
    assert "error" not in out["collections"][1]


def test_per_input_error_recorded_inline():
    """One handle taken → that entry has 'error', the other still succeeds."""
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdmin(
        responses=[
            ShopifyAdminError("/custom_collections.json returned 422: handle taken"),
            {"id": 333, "handle": "new", "title": "New Arrivals"},
        ]
    )
    svc = CollectionPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=22,
        collections=[
            {"handle": "all", "title": "All Products"},
            {"handle": "new", "title": "New Arrivals"},
        ],
    )

    assert len(out["collections"]) == 2
    assert "error" in out["collections"][0]
    assert "handle taken" in out["collections"][0]["error"]
    assert out["collections"][0].get("shopify_id") is None
    assert out["collections"][1]["shopify_id"] == "gid://shopify/Collection/333"
    assert out["collections"][1]["handle"] == "new"


def test_empty_collections_is_noop():
    cli = MagicMock()
    fake = _FakeAdmin()
    svc = CollectionPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=33,
        collections=[],
    )

    cli.get_token.assert_not_called()
    assert fake.calls == []
    assert out["collections"] == []
    assert out["dry_run"] is False
    assert out["task_id"] == 33


def test_cli_error_propagates_when_no_access_token():
    cli = MagicMock()
    cli.get_token.side_effect = ShopifyCliError("shopify CLI executable not found")

    fake = _FakeAdmin()
    svc = CollectionPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    with pytest.raises(ShopifyCliError, match="executable not found"):
        svc.push(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=3,
            task_id=44,
            collections=[{"handle": "all", "title": "All"}],
            access_token=None,
        )

    assert fake.calls == []
