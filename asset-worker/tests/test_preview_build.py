"""Tests for PreviewBuildService — dev-store preview-theme orchestration."""
from __future__ import annotations

import logging
from unittest.mock import MagicMock

import pytest

from app.clients.shopify_admin import ShopifyAdminError
from app.services.preview_build import (
    PreviewBuildError,
    PreviewBuildService,
)


SHOP = "dev-test.myshopify.com"


class _FakeAdmin:
    """Test double for ShopifyAdminClient surface used by preview build."""

    def __init__(
        self,
        theme: dict | None = None,
        product: dict | None = None,
        theme_exc: Exception | None = None,
        product_exc: Exception | None = None,
    ) -> None:
        self.theme = theme or {}
        self.product = product or {}
        self.theme_exc = theme_exc
        self.product_exc = product_exc
        self.calls: list[tuple] = []
        self.constructed_with: tuple | None = None

    def theme_create_unpublished(self, name: str) -> dict:
        self.calls.append(("theme_create_unpublished", name))
        if self.theme_exc is not None:
            raise self.theme_exc
        return self.theme

    def create_product(self, payload: dict) -> dict:
        self.calls.append(("create_product", payload))
        if self.product_exc is not None:
            raise self.product_exc
        return self.product


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


def _payload(handle: str = "my-product") -> dict:
    return {
        "id": 999,
        "handle": handle,
        "title": "My Product",
        "variants": [{"sku": "S1", "price": "9.99"}],
        "images": [{"src": "https://r2/preview-img.jpg"}],
    }


# ------------------------------------------------------------------ tests


def test_dry_run_synthesizes_url():
    cli = MagicMock()
    svc = PreviewBuildService(shopify_cli=cli, dry_run=True)

    out = svc.build(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=5,
        preview_id=42,
        product_payload=_payload(),
    )

    assert out["dry_run"] is True
    assert out["preview_id"] == 42
    # Theme id is a Shopify-style gid with a trailing numeric segment.
    assert isinstance(out["shopify_theme_id"], str)
    assert out["shopify_theme_id"].startswith("gid://shopify/OnlineStoreTheme/")
    numeric = out["shopify_theme_id"].rsplit("/", 1)[-1]
    assert numeric.isdigit()
    # Preview URL embeds shop domain + numeric theme id.
    assert SHOP in out["preview_url"]
    assert f"preview_theme_id={numeric}" in out["preview_url"]
    # Product-scoped URL exists when the payload carries a handle.
    assert out["product_preview_url"] is not None
    assert "/products/my-product?preview_theme_id=" in out["product_preview_url"]
    # Synthetic shopify_product_id, no Shopify or CLI calls in dry-run.
    assert isinstance(out["shopify_product_id"], str)
    assert out["shopify_product_id"].isdigit()
    cli.get_token.assert_not_called()


def test_real_path_calls_theme_create():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdmin(
        theme={
            "id": "gid://shopify/OnlineStoreTheme/123456",
            "name": "preview-product-999",
            "role": "UNPUBLISHED",
        },
        product={"id": 9876543210, "handle": "my-product", "title": "My Product"},
    )
    svc = PreviewBuildService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.build(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=5,
        preview_id=42,
        product_payload=_payload(),
    )

    cli.get_token.assert_called_once_with(SHOP)
    assert fake.constructed_with == (SHOP, "shpat_test")

    # Both mutations called, in order.
    methods = [c[0] for c in fake.calls]
    assert methods == ["theme_create_unpublished", "create_product"]

    # Theme name embeds the product id from the payload.
    _m, theme_name = fake.calls[0]
    assert "999" in theme_name
    assert theme_name.startswith("preview-")

    # create_product saw the inner payload WITHOUT our internal id field.
    _m, sent = fake.calls[1]
    assert "id" not in sent
    assert sent["handle"] == "my-product"

    assert out["dry_run"] is False
    assert out["shopify_theme_id"] == "gid://shopify/OnlineStoreTheme/123456"
    assert out["preview_url"].endswith("?preview_theme_id=123456")
    assert (
        out["product_preview_url"]
        == f"https://{SHOP}/products/my-product?preview_theme_id=123456"
    )
    assert out["shopify_product_id"] == "9876543210"
    assert out["preview_id"] == 42


def test_product_create_failure_continues_with_theme_only(caplog):
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdmin(
        theme={
            "id": "gid://shopify/OnlineStoreTheme/777777",
            "name": "preview-product-999",
            "role": "UNPUBLISHED",
        },
        product_exc=ShopifyAdminError("/products.json returned 422: handle taken"),
    )
    svc = PreviewBuildService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    with caplog.at_level(logging.WARNING, logger="app.services.preview_build"):
        out = svc.build(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=5,
            preview_id=42,
            product_payload=_payload(),
        )

    # Theme created, product attempted then swallowed; no exception.
    methods = [c[0] for c in fake.calls]
    assert methods == ["theme_create_unpublished", "create_product"]

    assert out["dry_run"] is False
    assert out["shopify_theme_id"] == "gid://shopify/OnlineStoreTheme/777777"
    assert out["preview_url"].endswith("?preview_theme_id=777777")
    # product_id is None because create_product raised.
    assert out["shopify_product_id"] is None
    # Warning recorded.
    assert any(
        "create_product failed" in rec.message for rec in caplog.records
    ), f"expected warning, got: {[r.message for r in caplog.records]}"


def test_theme_create_failure_raises_502():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdmin(
        theme_exc=ShopifyAdminError("graphql errors: themeCreate denied"),
    )
    svc = PreviewBuildService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    with pytest.raises(PreviewBuildError, match="theme create failed"):
        svc.build(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=5,
            preview_id=42,
            product_payload=_payload(),
        )

    # create_product never reached after theme failure.
    methods = [c[0] for c in fake.calls]
    assert methods == ["theme_create_unpublished"]


def test_explicit_access_token_skips_cli():
    cli = MagicMock()
    fake = _FakeAdmin(
        theme={"id": "gid://shopify/OnlineStoreTheme/555", "name": "t", "role": "UNPUBLISHED"},
        product={"id": 1, "handle": "h"},
    )
    svc = PreviewBuildService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    svc.build(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=5,
        preview_id=7,
        product_payload=_payload(),
        access_token="shpca_explicit",
    )

    cli.get_token.assert_not_called()
    assert fake.constructed_with == (SHOP, "shpca_explicit")


def test_payload_without_handle_omits_product_preview_url():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    fake = _FakeAdmin(
        theme={"id": "gid://shopify/OnlineStoreTheme/999", "name": "t", "role": "UNPUBLISHED"},
        product={"id": 1},
    )
    svc = PreviewBuildService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    payload = {"title": "X", "variants": [{"sku": "S", "price": "1"}]}

    out = svc.build(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=5,
        preview_id=8,
        product_payload=payload,
    )

    assert out["product_preview_url"] is None
    assert out["preview_url"].endswith("?preview_theme_id=999")
