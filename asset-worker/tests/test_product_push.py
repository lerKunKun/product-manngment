"""Tests for ProductPushService — relay-layer Shopify product create."""
from __future__ import annotations

import base64
from unittest.mock import MagicMock

import pytest

from app.clients.shopify_admin import ShopifyAdminValidationError
from app.clients.shopify_cli import ShopifyCliError
from app.services.product_push import ProductPushService, R2FetchError


SHOP = "demo.myshopify.com"


class _FakeAdmin:
    def __init__(
        self,
        product: dict | None = None,
        raise_exc: Exception | None = None,
    ) -> None:
        self.product = product or {}
        self.raise_exc = raise_exc
        self.calls: list[tuple] = []
        self.constructed_with: tuple | None = None

    def create_product(self, product_payload: dict) -> dict:
        self.calls.append(("create_product", product_payload))
        if self.raise_exc is not None:
            raise self.raise_exc
        return self.product


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


def _payload(handle: str = "push-test") -> dict:
    return {
        "title": "Push Test",
        "handle": handle,
        "status": "active",
        "variants": [{"sku": "PUSH-1", "price": "9.99"}],
        "images": [{"src": "https://r2/x/image-1.jpg", "alt": "x"}],
    }


# ----------------------------------------------------------------------- tests


def test_dry_run_returns_synthetic_id():
    cli = MagicMock()

    svc = ProductPushService(shopify_cli=cli, dry_run=True)
    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=99,
        product_payload=_payload(),
    )

    assert out["dry_run"] is True
    assert out["task_id"] == 99
    # Synthetic id is a 10-digit numeric string.
    assert isinstance(out["shopify_product_id"], str)
    assert out["shopify_product_id"].isdigit()
    assert len(out["shopify_product_id"]) == 10
    # Echoes the requested handle as actual.
    assert out["shopify_handle"] == "push-test"
    assert out["conflict"] is None
    # No Shopify / CLI calls in dry-run.
    cli.get_token.assert_not_called()


def test_real_path_calls_create_product():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdmin(
        product={
            "id": 1234567890,
            "handle": "push-test",
            "title": "Push Test",
            "status": "active",
        }
    )
    svc = ProductPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    payload = _payload()
    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=99,
        product_payload=payload,
    )

    cli.get_token.assert_called_once_with(SHOP)
    assert fake.constructed_with == (SHOP, "shpat_test")
    # create_product called exactly once with the inner product payload.
    assert len(fake.calls) == 1
    method, sent_payload = fake.calls[0]
    assert method == "create_product"
    # The service shallow-copies the payload to strip ``media_r2_keys`` before
    # posting (see W2-PUSH-03). When no media keys are set, the resulting
    # payload is structurally equal to the input and never carries
    # ``media_r2_keys``.
    assert sent_payload == payload
    assert "media_r2_keys" not in sent_payload
    # Sanity: client wraps in {"product": ...} internally; we just assert
    # the service handed the inner dict to admin.create_product().

    assert out["dry_run"] is False
    assert out["shopify_product_id"] == "1234567890"
    assert out["shopify_handle"] == "push-test"
    assert out["conflict"] is None
    assert out["task_id"] == 99


def test_handle_rename_detected():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdmin(
        product={
            "id": 5555,
            "handle": "renamed-handle-2",  # Shopify renamed it!
            "title": "Push Test",
        }
    )
    svc = ProductPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=42,
        product_payload=_payload(handle="push-test"),
    )

    assert out["shopify_handle"] == "renamed-handle-2"
    assert out["conflict"] == {
        "type": "HANDLE_RENAMED",
        "requested": "push-test",
        "actual": "renamed-handle-2",
    }
    assert out["shopify_product_id"] == "5555"


def test_validation_error_returned_not_raised():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    err_body = {
        "errors": {
            "handle": ["has already been taken"],
        }
    }
    fake = _FakeAdmin(
        raise_exc=ShopifyAdminValidationError(
            "/products.json returned 422: {...}", body=err_body
        )
    )
    svc = ProductPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    # MUST NOT raise — service catches and converts to dict.
    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=77,
        product_payload=_payload(),
    )

    assert out["conflict"] == {"type": "VALIDATION", "details": err_body}
    assert out["shopify_product_id"] is None
    assert out["shopify_handle"] is None
    assert out["task_id"] == 77
    assert "error" in out


def test_cli_error_propagates_when_no_access_token():
    cli = MagicMock()
    cli.get_token.side_effect = ShopifyCliError("shopify CLI executable not found")

    # admin_factory should never be called; if it is, the test will fail
    # because the fake will record a call.
    fake = _FakeAdmin()
    svc = ProductPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    with pytest.raises(ShopifyCliError, match="executable not found"):
        svc.push(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=3,
            task_id=1,
            product_payload=_payload(),
            access_token=None,
        )

    cli.get_token.assert_called_once_with(SHOP)
    # No admin call ever happened.
    assert fake.calls == []


# ----------------------------------------------- W2-PUSH-03 (media via R2) ---


def test_push_with_media_r2_keys_downloads_and_attaches():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdmin(
        product={"id": 7777777777, "handle": "with-media", "title": "Media"}
    )
    r2 = MagicMock()
    r2.get_object.side_effect = [
        (b"\x89PNG-bytes-1", "image/png"),
        (b"\xff\xd8JPEG-bytes-2", "image/jpeg"),
    ]
    svc = ProductPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
        r2_client=r2,
    )

    payload = {
        "title": "With Media",
        "handle": "with-media",
        "status": "active",
        "variants": [{"sku": "M-1", "price": "1.00"}],
        "images": [{"src": "https://r2/preexisting.jpg"}],  # caller-supplied
        "media_r2_keys": [
            "tenants/1/stores/3/snapshots/42/product/image-1.png",
            "tenants/1/stores/3/snapshots/42/product/image-2.jpg",
        ],
    }
    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=11,
        product_payload=payload,
    )

    # R2 was hit once per key.
    assert r2.get_object.call_count == 2

    # admin.create_product saw a payload WITHOUT media_r2_keys but WITH the
    # base64 attachments appended after any existing src-based images.
    assert len(fake.calls) == 1
    _method, sent_payload = fake.calls[0]
    assert "media_r2_keys" not in sent_payload
    images = sent_payload["images"]
    assert len(images) == 3  # 1 caller-supplied + 2 R2-loaded
    assert images[0] == {"src": "https://r2/preexisting.jpg"}
    assert "attachment" in images[1] and images[1]["filename"].endswith(".png")
    assert "attachment" in images[2] and images[2]["filename"].endswith(".jpg")
    assert base64.b64decode(images[1]["attachment"]) == b"\x89PNG-bytes-1"
    assert base64.b64decode(images[2]["attachment"]) == b"\xff\xd8JPEG-bytes-2"

    # Caller's payload was not mutated (defensive copy).
    assert "media_r2_keys" in payload
    assert len(payload["images"]) == 1

    assert out["dry_run"] is False
    assert out["shopify_product_id"] == "7777777777"


def test_push_with_media_r2_keys_dry_run_synthesizes_attachments():
    cli = MagicMock()
    r2 = MagicMock()  # MUST NOT be called

    svc = ProductPushService(
        shopify_cli=cli,
        dry_run=True,
        r2_client=r2,
    )

    payload = {
        "title": "Dry Run Media",
        "handle": "dry-run-media",
        "variants": [{"sku": "DR-1", "price": "9.99"}],
        "media_r2_keys": ["a/b.jpg", "c/d.png"],
    }
    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=88,
        product_payload=payload,
    )

    assert out["dry_run"] is True
    cli.get_token.assert_not_called()
    r2.get_object.assert_not_called()

    images = out["shopify_admin_response"]["images"]
    assert len(images) == 2
    assert images[0]["filename"].endswith(".jpg")
    assert images[1]["filename"].endswith(".png")
    # Both are valid base64 of *something* non-empty.
    for img in images:
        assert "attachment" in img
        decoded = base64.b64decode(img["attachment"])
        assert decoded  # non-empty


# ------------------------------------------------- Track AS5 (suffix + metafields) ---


def test_template_suffix_is_forwarded_to_shopify():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdmin(
        product={"id": 999, "handle": "with-suffix", "title": "T"}
    )
    svc = ProductPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    payload = _payload(handle="with-suffix")
    payload["template_suffix"] = "premium"

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=42,
        product_payload=payload,
    )

    # admin.create_product saw template_suffix verbatim — it is a normal Shopify
    # product field, NOT a worker-internal extension like media_r2_keys.
    assert len(fake.calls) == 1
    _method, sent = fake.calls[0]
    assert sent.get("template_suffix") == "premium"
    assert out["dry_run"] is False


class _FakeAdminWithGraphQL(_FakeAdmin):
    """``_FakeAdmin`` augmented with a ``graphql`` shim for metafieldsSet tests."""

    def __init__(
        self,
        product: dict | None = None,
        graphql_response: dict | None = None,
        graphql_error: Exception | None = None,
    ) -> None:
        super().__init__(product=product)
        self._graphql_response = graphql_response or {
            "metafieldsSet": {"metafields": [], "userErrors": []}
        }
        self._graphql_error = graphql_error
        self.graphql_calls: list[tuple] = []

    def graphql(self, query: str, variables: dict | None = None) -> dict:
        self.graphql_calls.append((query, variables))
        if self._graphql_error is not None:
            raise self._graphql_error
        return self._graphql_response


def test_metafields_are_set_via_graphql_after_create():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdminWithGraphQL(
        product={"id": 5555, "handle": "with-mf", "title": "MF"},
        graphql_response={
            "metafieldsSet": {
                "metafields": [
                    {
                        "id": "gid://shopify/Metafield/1",
                        "namespace": "custom",
                        "key": "tagline",
                        "type": "single_line_text_field",
                        "value": "Hello {{brand}}",
                    }
                ],
                "userErrors": [],
            }
        },
    )
    svc = ProductPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    payload = _payload(handle="with-mf")
    payload["metafields"] = [
        {
            "namespace": "custom",
            "key": "tagline",
            "type": "single_line_text_field",
            "value": "Hello {{brand}}",
        },
        # Skip-eligible: missing namespace.
        {"key": "ignore_me", "value": "x"},
    ]

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=10,
        product_payload=payload,
    )

    # Product create body MUST NOT carry metafields — Shopify REST product
    # create rejects them. They go through metafieldsSet AFTER the product
    # exists.
    _method, sent_payload = fake.calls[0]
    assert "metafields" not in sent_payload

    # GraphQL metafieldsSet was hit once with the gid + the well-formed entry only.
    assert len(fake.graphql_calls) == 1
    _q, variables = fake.graphql_calls[0]
    assert variables is not None
    assert variables["metafields"] == [
        {
            "ownerId": "gid://shopify/Product/5555",
            "namespace": "custom",
            "key": "tagline",
            "type": "single_line_text_field",
            "value": "Hello {{brand}}",
        }
    ]

    # Result echoes Shopify's metafieldsSet payload for caller-side audit.
    assert out["metafields_set"]["metafields"][0]["namespace"] == "custom"


def test_metafields_user_errors_do_not_fail_push():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdminWithGraphQL(
        product={"id": 6666, "handle": "with-mf-err", "title": "MFE"},
        graphql_response={
            "metafieldsSet": {
                "metafields": [],
                "userErrors": [{"field": ["value"], "message": "Bad type", "code": "INVALID_TYPE"}],
            }
        },
    )
    svc = ProductPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    payload = _payload(handle="with-mf-err")
    payload["metafields"] = [
        {
            "namespace": "custom",
            "key": "broken",
            "type": "broken_type",
            "value": "x",
        }
    ]

    # Push must STILL succeed (product was created); metafields_set carries the error.
    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=11,
        product_payload=payload,
    )
    assert out["shopify_product_id"] == "6666"
    assert "error" in out["metafields_set"]


def test_no_metafields_means_no_graphql_call():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdminWithGraphQL(
        product={"id": 7000, "handle": "no-mf", "title": "NM"}
    )
    svc = ProductPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=12,
        product_payload=_payload(handle="no-mf"),
    )
    assert out["shopify_product_id"] == "7000"
    assert fake.graphql_calls == []
    assert "metafields_set" not in out


def test_push_r2_fetch_failure_raises():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    fake = _FakeAdmin()  # MUST NOT be called
    r2 = MagicMock()
    r2.get_object.side_effect = RuntimeError("R2Client is not configured: missing endpoint")

    svc = ProductPushService(
        shopify_cli=cli,
        admin_factory=_factory_for(fake),
        dry_run=False,
        r2_client=r2,
    )

    payload = {
        "title": "X",
        "handle": "x",
        "variants": [{"sku": "X-1", "price": "1.00"}],
        "media_r2_keys": ["bad/key.jpg"],
    }

    # R2FetchError is a subclass of ShopifyAdminError (route maps to 502).
    with pytest.raises(R2FetchError, match="r2 fetch failed for bad/key.jpg"):
        svc.push(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=3,
            task_id=33,
            product_payload=payload,
        )

    # No Shopify call happened.
    assert fake.calls == []
