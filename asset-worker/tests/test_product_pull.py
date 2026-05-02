"""Tests for ProductPullService orchestration."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from app.clients.shopify_admin import ShopifyAdminError
from app.services.product_pull import ProductPullService, _extract_image_ext


SHOP = "demo.myshopify.com"


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
    r2 = MagicMock()
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
    # 1 product.json + 2 synthetic images = 3 files.
    assert out["file_count"] == 3
    assert out["r2_prefix"] == "tenants/1/stores/3/snapshots/42/product/"
    assert out["manifest_key"].endswith("manifest.json")
    # Shopify CLI / downloader are still NOT touched in dry-run.
    cli.get_token.assert_not_called()
    downloader.assert_not_called()
    # But dry-run DOES upload synthetic content + manifest to R2 now
    # (so backend's downloadBytes(productJsonKey) doesn't 404 in W2-SNAP-04).
    # 3 synthetic files + 1 manifest = 4 put_object calls.
    assert r2.put_object.call_count == 4
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[-1].endswith("manifest.json")


def test_dry_run_uploads_each_synthetic_file_to_r2():
    """Integration-style: verify every synthetic file lands in R2 under the
    expected prefix, with manifest written last."""
    cli = MagicMock()
    r2 = MagicMock()

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
        snapshot_id=777,
        product_id=999,
    )

    assert r2.put_object.call_count >= out["file_count"] + 1
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    prefix = "tenants/1/stores/3/snapshots/777/product/"
    # Every uploaded key sits under the snapshot prefix.
    for k in keys:
        assert k.startswith(prefix)
    # First key is product.json (so backend's downloadBytes works).
    assert keys[0] == f"{prefix}product.json"
    # Last is the manifest.
    assert keys[-1].endswith("manifest.json")
    # Image keys present.
    assert any(k.endswith("image-1.jpg") for k in keys)
    assert any(k.endswith("image-2.png") for k in keys)


def test_dry_run_swallows_r2_errors():
    """Dry-run must keep working even if R2 is misconfigured — the manifest
    is still returned and only a WARN log is emitted."""
    cli = MagicMock()
    r2 = MagicMock()
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
    # Should NOT raise; in-memory manifest still comes back.
    assert out["dry_run"] is True
    assert out["file_count"] == 3
    assert out["manifest_key"].endswith("manifest.json")
    # Every put_object attempt was made (each WARNed).
    assert r2.put_object.call_count == 4


def test_real_path_downloads_each_image():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()

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

    # CLI + factory wired correctly.
    cli.get_token.assert_called_once_with(SHOP)
    assert fake.constructed_with == (SHOP, "shpat_test")
    assert fake.calls == [("get_product", 7777)]

    # 1 product.json + 3 images + 1 manifest = 5 put_object calls.
    assert r2.put_object.call_count == 5
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[0].endswith("product.json")
    assert any(k.endswith("image-1.jpg") for k in keys)
    assert any(k.endswith("image-2.png") for k in keys)
    assert any(k.endswith("image-3.webp") for k in keys)
    assert keys[-1].endswith("manifest.json")

    assert out["file_count"] == 4  # excluded manifest itself per contract
    # Manifest payload checks.
    manifest = json.loads(r2.put_object.call_args_list[-1].args[1].decode("utf-8"))
    assert manifest["product_id"] == 7777
    assert manifest["product_handle"] == "demo"
    assert manifest["summary"]["image_count"] == 3
    assert manifest["summary"]["variant_count"] == 1


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
    r2 = MagicMock()

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


def test_manifest_summary_counts():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = MagicMock()

    product = {
        "id": 5555,
        "handle": "multi",
        "title": "Multi-variant",
        "variants": [
            {"id": 1, "title": "S"},
            {"id": 2, "title": "M"},
            {"id": 3, "title": "L"},
            {"id": 4, "title": "XL"},
            {"id": 5, "title": "XXL"},
        ],
        "images": [
            {"id": 11, "position": 1, "src": "https://cdn/a.jpg"},
            {"id": 12, "position": 2, "src": "https://cdn/b.png"},
        ],
    }
    fake = _FakeAdmin(product=product)
    downloader = _fake_downloader_factory(
        {
            "https://cdn/a.jpg": (b"AAA", "image/jpeg"),
            "https://cdn/b.png": (b"BBBB", "image/png"),
        }
    )

    svc = ProductPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        downloader=downloader,
        dry_run=False,
    )
    svc.pull(
        shop_domain=SHOP,
        tenant_id=1,
        store_id=3,
        snapshot_id=42,
        product_id=5555,
    )

    # Last put_object is the manifest.
    manifest = json.loads(r2.put_object.call_args_list[-1].args[1].decode("utf-8"))
    images = product["images"]
    variants = product["variants"]

    assert manifest["summary"]["image_count"] == len(images)
    assert manifest["summary"]["variant_count"] == len(variants)
    assert manifest["summary"]["file_count"] == 1 + len(images)
    # total_bytes = product.json bytes + 3 + 4
    file_sizes = [f["size"] for f in manifest["files"]]
    assert manifest["summary"]["total_bytes"] == sum(file_sizes)
