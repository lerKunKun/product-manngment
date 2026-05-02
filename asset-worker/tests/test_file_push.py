"""Tests for FilePushService — saga MEDIA step relay (R2 → Shopify Files)."""
from __future__ import annotations

import base64
from unittest.mock import MagicMock

import pytest

from app.clients.shopify_admin import ShopifyAdminError
from app.clients.shopify_cli import ShopifyCliError
from app.services.file_push import FilePushService, R2FetchError


SHOP = "demo.myshopify.com"


class _FakeAdmin:
    def __init__(
        self,
        files: list[dict] | None = None,
        raise_exc: Exception | None = None,
    ) -> None:
        self.files = files or []
        self.raise_exc = raise_exc
        self.calls: list[tuple] = []
        self.constructed_with: tuple | None = None

    def file_create(self, files: list[dict]) -> list[dict]:
        self.calls.append(("file_create", files))
        if self.raise_exc is not None:
            raise self.raise_exc
        return self.files


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


# ----------------------------------------------------------------------- tests


def test_dry_run_returns_synthetic_ids():
    cli = MagicMock()
    r2 = MagicMock()  # MUST NOT be touched

    svc = FilePushService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=99,
        r2_keys=["a/b.jpg", "c/d.png"],
    )

    assert out["dry_run"] is True
    assert out["task_id"] == 99
    assert len(out["files"]) == 2
    # Synthetic ids look like Shopify gids.
    assert out["files"][0]["shopify_id"].startswith("gid://shopify/MediaImage/")
    assert out["files"][0]["r2Key"] == "a/b.jpg"
    assert out["files"][1]["r2Key"] == "c/d.png"
    assert "url" in out["files"][0]
    cli.get_token.assert_not_called()
    r2.get_object.assert_not_called()


def test_real_path_downloads_and_calls_file_create():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    r2 = MagicMock()
    r2.get_object.side_effect = [
        (b"\x89PNG-bytes-1", "image/png"),
        (b"\xff\xd8JPEG-bytes-2", "image/jpeg"),
    ]
    fake = _FakeAdmin(
        files=[
            {
                "id": "gid://shopify/MediaImage/1001",
                "image": {"url": "https://cdn.shopify.com/s/files/1001.png"},
                "alt": None,
            },
            {
                "id": "gid://shopify/MediaImage/1002",
                "image": {"url": "https://cdn.shopify.com/s/files/1002.jpg"},
                "alt": None,
            },
        ]
    )
    svc = FilePushService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=11,
        r2_keys=["k1.png", "k2.jpg"],
    )

    cli.get_token.assert_called_once_with(SHOP)
    assert fake.constructed_with == (SHOP, "shpat_test")
    assert r2.get_object.call_count == 2

    # file_create saw the right base64-encoded inputs.
    assert len(fake.calls) == 1
    _method, sent_inputs = fake.calls[0]
    assert len(sent_inputs) == 2
    src0 = sent_inputs[0]["originalSource"]
    assert src0.startswith("data:image/png;base64,")
    assert base64.b64decode(src0.split(",", 1)[1]) == b"\x89PNG-bytes-1"
    src1 = sent_inputs[1]["originalSource"]
    assert src1.startswith("data:image/jpeg;base64,")
    assert base64.b64decode(src1.split(",", 1)[1]) == b"\xff\xd8JPEG-bytes-2"

    assert out["dry_run"] is False
    assert out["task_id"] == 11
    assert len(out["files"]) == 2
    assert out["files"][0] == {
        "r2Key": "k1.png",
        "shopify_id": "gid://shopify/MediaImage/1001",
        "url": "https://cdn.shopify.com/s/files/1001.png",
    }
    assert out["files"][1]["r2Key"] == "k2.jpg"
    assert out["files"][1]["shopify_id"] == "gid://shopify/MediaImage/1002"
    assert out["files"][1]["url"] == "https://cdn.shopify.com/s/files/1002.jpg"


def test_empty_r2_keys_is_noop():
    cli = MagicMock()
    r2 = MagicMock()
    fake = _FakeAdmin()
    svc = FilePushService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    out = svc.push(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        task_id=22,
        r2_keys=[],
    )

    # No CLI / R2 / Shopify calls happened.
    cli.get_token.assert_not_called()
    r2.get_object.assert_not_called()
    assert fake.calls == []
    assert out["files"] == []
    assert out["task_id"] == 22
    assert out["dry_run"] is False


def test_r2_fetch_failure_propagates():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    r2 = MagicMock()
    r2.get_object.side_effect = RuntimeError("R2Client is not configured: missing endpoint")

    fake = _FakeAdmin()  # MUST NOT be called
    svc = FilePushService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    with pytest.raises(R2FetchError, match="r2 fetch failed for bad/key.jpg"):
        svc.push(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=3,
            task_id=33,
            r2_keys=["bad/key.jpg"],
        )

    # No Shopify call ever happened — service raised before file_create.
    assert fake.calls == []


def test_shopify_admin_error_propagates():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"

    r2 = MagicMock()
    r2.get_object.return_value = (b"bytes", "image/jpeg")

    fake = _FakeAdmin(raise_exc=ShopifyAdminError("graphql userErrors: [...]"))
    svc = FilePushService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    with pytest.raises(ShopifyAdminError, match="userErrors"):
        svc.push(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=3,
            task_id=44,
            r2_keys=["a/b.jpg"],
        )


def test_cli_error_propagates_when_no_access_token():
    cli = MagicMock()
    cli.get_token.side_effect = ShopifyCliError("shopify CLI executable not found")

    r2 = MagicMock()
    r2.get_object.return_value = (b"bytes", "image/png")
    fake = _FakeAdmin()
    svc = FilePushService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )

    with pytest.raises(ShopifyCliError, match="executable not found"):
        svc.push(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=3,
            task_id=55,
            r2_keys=["x/y.jpg"],
            access_token=None,
        )

    # No admin call ever happened.
    assert fake.calls == []
