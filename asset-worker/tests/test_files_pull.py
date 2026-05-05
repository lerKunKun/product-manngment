"""Tests for FilesPullService orchestration (CAS-backed, AS3)."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from app.services.files_pull import FilesPullService


SHOP = "demo.myshopify.com"


def _r2_with_miss():
    """A MagicMock R2 client whose head_object always reports a CAS miss."""
    r2 = MagicMock()
    r2.head_object.return_value = False
    return r2


class _FakeAdmin:
    """Minimal stand-in for ShopifyAdminClient that returns canned graphql pages."""

    def __init__(self, graphql_pages: list[dict]) -> None:
        # Each page is the ``data`` payload that ``graphql`` would return.
        self._pages = list(graphql_pages)
        self.calls: list[tuple] = []

    def graphql(self, query: str, variables: dict | None = None) -> dict:
        self.calls.append(("graphql", variables or {}))
        if not self._pages:
            return {"files": {"pageInfo": {"hasNextPage": False}, "edges": []}}
        return self._pages.pop(0)


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


def _fake_downloader(returns: dict[str, tuple[bytes, str]]):
    """Return a downloader callable that maps URL -> (body, content_type)."""

    def _impl(url: str, timeout_seconds: float = 30.0):
        if url in returns:
            return returns[url]
        raise RuntimeError(f"unexpected url: {url}")

    return _impl


# ----------------------------------------------------------------------- tests


def test_dry_run_returns_synthetic_files():
    cli = MagicMock()
    r2 = _r2_with_miss()

    svc = FilesPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    assert out["dry_run"] is True
    assert out["file_count"] == 2
    assert out["r2_prefix"] == "tenants/1/stores/3/snapshots/42/files/"
    assert out["manifest_key"].endswith("manifest.json")
    cli.get_token.assert_not_called()
    # 2 synthetic CAS PUTs + 1 manifest = 3.
    assert r2.put_object.call_count == 3


def test_real_path_paginates_and_downloads_each_node():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    page1 = {
        "files": {
            "pageInfo": {"hasNextPage": True, "endCursor": "cur-1"},
            "edges": [
                {
                    "cursor": "c1",
                    "node": {
                        "id": "gid://shopify/MediaImage/2001",
                        "alt": "hero",
                        "fileStatus": "READY",
                        "image": {"url": "https://cdn/files/hero.jpg"},
                        "originalSource": {
                            "url": "https://cdn/files/hero.jpg",
                            "mimeType": "image/jpeg",
                            "fileSize": 12,
                        },
                    },
                }
            ],
        }
    }
    page2 = {
        "files": {
            "pageInfo": {"hasNextPage": False, "endCursor": None},
            "edges": [
                {
                    "cursor": "c2",
                    "node": {
                        "id": "gid://shopify/GenericFile/3001",
                        "alt": "manual",
                        "fileStatus": "READY",
                        "url": "https://cdn/files/manual.pdf",
                        "mimeType": "application/pdf",
                    },
                }
            ],
        }
    }
    fake = _FakeAdmin(graphql_pages=[page1, page2])

    download_returns = {
        "https://cdn/files/hero.jpg": (b"JPGDATA", "image/jpeg"),
        "https://cdn/files/manual.pdf": (b"%PDF-1.4 manual", "application/pdf"),
    }

    svc = FilesPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        downloader=_fake_downloader(download_returns),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    cli.get_token.assert_called_once_with(SHOP)
    # Expect two graphql calls (page1 + page2) — pagination terminates on hasNextPage=false.
    assert sum(1 for c in fake.calls if c[0] == "graphql") == 2
    # First call no cursor; second call uses the endCursor from page1.
    assert fake.calls[0][1].get("cursor") is None
    assert fake.calls[1][1].get("cursor") == "cur-1"

    assert out["file_count"] == 2
    # 2 CAS PUTs + 1 manifest
    assert r2.put_object.call_count == 3
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    for k in keys[:-1]:
        assert k.startswith("tenants/1/cas/")
    assert keys[-1].endswith("manifest.json")

    manifest = json.loads(r2.put_object.call_args_list[-1].args[1].decode("utf-8"))
    paths = sorted(e["relative_path"] for e in manifest["entries"])
    assert paths == ["2001.jpg", "3001.pdf"]


def test_empty_files_yields_valid_empty_manifest():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(
        graphql_pages=[
            {"files": {"pageInfo": {"hasNextPage": False}, "edges": []}}
        ]
    )

    svc = FilesPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    assert out["file_count"] == 0
    assert out["total_bytes"] == 0
    # Only manifest is written.
    assert r2.put_object.call_count == 1
    manifest_call = r2.put_object.call_args_list[-1]
    assert manifest_call.args[0].endswith("manifest.json")
    manifest = json.loads(manifest_call.args[1].decode("utf-8"))
    assert manifest["entries"] == []


def test_skip_node_without_url_does_not_download():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(
        graphql_pages=[
            {
                "files": {
                    "pageInfo": {"hasNextPage": False},
                    "edges": [
                        {
                            "cursor": "c1",
                            "node": {
                                "id": "gid://shopify/Video/9001",
                                "alt": None,
                                "fileStatus": "PROCESSING",
                                "originalSource": None,
                                "preview": None,
                            },
                        }
                    ],
                }
            }
        ]
    )

    downloads = MagicMock(side_effect=AssertionError("should not be called"))
    svc = FilesPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        downloader=downloads,
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    downloads.assert_not_called()
    assert out["file_count"] == 0
    assert r2.put_object.call_count == 1  # manifest only
