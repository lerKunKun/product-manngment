"""Tests for ProductPullService orchestration (CAS-backed, AS2)."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from app.clients.shopify_admin import ShopifyAdminError
from app.services.product_pull import ProductPullService, _extract_image_ext


SHOP = "demo.myshopify.com"


def _r2_with_miss():
    r2 = MagicMock()
    r2.head_object.return_value = False
    return r2


class _FakeAdmin:
    def __init__(self, product: dict | None = None, raise_exc: Exception | None = None) -> None:
        self.product = product or {}
        self.raise_exc = raise_exc
        self.calls: list[tuple] = []

    def get_product(self, product_id: int) -> dict:
        self.calls.append(("get_product", product_id))
        if self.raise_exc is not None:
            raise self.raise_exc
        return self.product


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


def _fake_downloader_factory(payloads: dict[str, tuple[bytes, str]]):
    """Returns a downloader callable that maps URL -> (bytes, content_type)."""

    def _downloader(url: str, timeout_seconds: float = 30.0):
        if url not in payloads:
            raise AssertionError(f"unexpected URL: {url}")
        return payloads[url]

    return _downloader


# ----------------------------------------------------------------------- tests


def test_dry_run_returns_synthetic_manifest():
    cli = MagicMock()
    r2 = _r2_with_miss()
    downloader = MagicMock()

    svc = ProductPullService(
        shopify_cli=cli,
        r2_client=r2,
        downloader=downloader,
        dry_run=True,
    )
    out = svc.pull(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        snapshot_id=42,
        product_id=999,
    )

    assert out["dry_run"] is True
    # 1 product.json + 2 synthetic images = 3 manifest entries.
    assert out["file_count"] == 3
    assert out["r2_prefix"] == "tenants/1/stores/3/snapshots/42/product/"
    assert out["manifest_key"].endswith("manifest.json")
    cli.get_token.assert_not_called()
    downloader.assert_not_called()
    # 1 CAS PUT for product.json + 1 LEGACY PUT for product.json + 2 image CAS
    # PUTs + 1 manifest = 5 put_object calls.
    assert r2.put_object.call_count == 5
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    # legacy product.json must be present (backend reads it directly).
    assert any(k == "tenants/1/stores/3/snapshots/42/product/product.json" for k in keys)
    # last key is manifest.
    assert keys[-1].endswith("manifest.json")


def test_dry_run_writes_legacy_product_json_under_prefix():
    """Backend ``SnapshotGenerationService`` reads ``{prefix}product.json``
    directly. The pull must keep emitting that key alongside the CAS write."""
    cli = MagicMock()
    r2 = _r2_with_miss()

    svc = ProductPullService(
        shopify_cli=cli,
        r2_client=r2,
        downloader=MagicMock(),
        dry_run=True,
    )
    svc.pull(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        snapshot_id=777,
        product_id=999,
    )

    keys = [c.args[0] for c in r2.put_object.call_args_list]
    legacy_key = "tenants/1/stores/3/snapshots/777/product/product.json"
    assert legacy_key in keys


def test_dry_run_swallows_r2_errors():
    cli = MagicMock()
    r2 = _r2_with_miss()
    r2.head_object.side_effect = RuntimeError("R2 not configured")
    r2.put_object.side_effect = RuntimeError("R2 not configured")

    svc = ProductPullService(
        shopify_cli=cli,
        r2_client=r2,
        downloader=MagicMock(),
        dry_run=True,
    )
    out = svc.pull(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        snapshot_id=42,
        product_id=999,
    )
    assert out["dry_run"] is True
    assert out["file_count"] == 3


def test_real_path_routes_images_through_cas():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    product = {
        "id": 7777,
        "handle": "demo",
        "title": "Demo",
        "variants": [{"id": 1, "title": "Default"}],
        "images": [
            {"id": 100, "position": 1, "src": "https://cdn.shopify.com/s/files/1/x/foo.jpg?v=1"},
            {"id": 101, "position": 2, "src": "https://cdn.shopify.com/s/files/1/x/bar.PNG"},
            {"id": 102, "position": 3, "src": "https://cdn.shopify.com/s/files/1/x/baz.webp"},
        ],
    }
    fake = _FakeAdmin(product=product)
    downloader = _fake_downloader_factory(
        {
            "https://cdn.shopify.com/s/files/1/x/foo.jpg?v=1": (b"JPGDATA", "image/jpeg"),
            "https://cdn.shopify.com/s/files/1/x/bar.PNG": (b"PNGBYTES!!", "image/png"),
            "https://cdn.shopify.com/s/files/1/x/baz.webp": (b"WEBP", "image/webp"),
        }
    )

    svc = ProductPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        downloader=downloader,
        dry_run=False,
    )
    out = svc.pull(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        snapshot_id=42,
        product_id=7777,
    )

    cli.get_token.assert_called_once_with(SHOP)
    assert fake.constructed_with == (SHOP, "shpat_test")
    assert fake.calls == [("get_product", 7777)]

    # 1 CAS PUT product.json + 1 LEGACY product.json PUT + 3 image CAS PUTs +
    # 1 manifest = 6 put_object calls.
    assert r2.put_object.call_count == 6
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    # legacy product.json present.
    assert "tenants/1/stores/3/snapshots/42/product/product.json" in keys
    # image bytes were uploaded under tenant CAS prefix.
    cas_keys = [k for k in keys if k.startswith("tenants/1/cas/")]
    assert len(cas_keys) == 4  # product.json + 3 images
    # manifest last
    assert keys[-1].endswith("manifest.json")

    assert out["file_count"] == 4  # product.json + 3 images, manifest excluded
    # Manifest body — CAS shape.
    manifest = json.loads(r2.put_object.call_args_list[-1].args[1].decode("utf-8"))
    assert manifest["version"] == 1
    paths = sorted(e["relative_path"] for e in manifest["entries"])
    assert paths == [
        "image-1.jpg",
        "image-2.png",
        "image-3.webp",
        "product.json",
    ]
    # Image entries carry source_url
    img1 = next(e for e in manifest["entries"] if e["relative_path"] == "image-1.jpg")
    assert img1["source_url"].startswith("https://cdn.shopify.com/")


@pytest.mark.parametrize(
    "url, expected",
    [
        ("https://cdn/foo.JPG?v=1", "jpg"),
        ("https://cdn/foo.png", "png"),
        ("https://cdn/foo", "bin"),
        ("https://cdn/foo.bmp", "bin"),
        ("https://cdn/foo.jpeg", "jpg"),
        ("https://cdn/foo.WEBP?w=400&h=400", "webp"),
        ("https://cdn/foo.gif", "gif"),
        ("", "bin"),
    ],
)
def test_image_extension_detection(url: str, expected: str):
    assert _extract_image_ext(url) == expected


def test_admin_error_propagates():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(raise_exc=ShopifyAdminError("boom"))
    svc = ProductPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        downloader=MagicMock(),
        dry_run=False,
    )

    with pytest.raises(ShopifyAdminError, match="boom"):
        svc.pull(
            shop_domain=SHOP,
            tenant_id=1,
            store_id=3,
            snapshot_id=42,
            product_id=12345,
        )
    # Nothing was uploaded — fail fast before product.json write.
    r2.put_object.assert_not_called()
