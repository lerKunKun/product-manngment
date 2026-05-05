"""Tests for PolicyPullService orchestration (CAS-backed, AS2)."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from app.clients.shopify_admin import ShopifyAdminError
from app.services.policy_pull import PolicyPullService


SHOP = "demo.myshopify.com"


def _r2_with_miss():
    r2 = MagicMock()
    r2.head_object.return_value = False
    return r2


class _FakeAdmin:
    def __init__(
        self,
        policies: list[dict] | None = None,
        get_policies_error: Exception | None = None,
    ) -> None:
        self.policies = policies or []
        self.get_policies_error = get_policies_error
        self.calls: list[tuple] = []

    def get_policies(self) -> list[dict]:
        self.calls.append(("get_policies",))
        if self.get_policies_error is not None:
            raise self.get_policies_error
        return self.policies


def _factory_for(fake: _FakeAdmin):
    def _factory(shop_domain: str, token: str, **_kwargs):
        fake.constructed_with = (shop_domain, token)
        return fake

    return _factory


def test_dry_run_returns_two_policies():
    cli = MagicMock()
    r2 = _r2_with_miss()

    svc = PolicyPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    assert out["dry_run"] is True
    assert out["file_count"] == 2
    assert out["r2_prefix"] == "tenants/1/stores/3/snapshots/42/policy/"
    assert out["manifest_key"].endswith("manifest.json")
    cli.get_token.assert_not_called()
    # 2 policy CAS PUTs + 1 manifest = 3 put_object calls.
    assert r2.put_object.call_count == 3
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    assert keys[-1].endswith("manifest.json")


def test_dry_run_swallows_r2_errors():
    cli = MagicMock()
    r2 = _r2_with_miss()
    r2.head_object.side_effect = RuntimeError("R2 not configured")
    r2.put_object.side_effect = RuntimeError("R2 not configured")

    svc = PolicyPullService(shopify_cli=cli, r2_client=r2, dry_run=True)
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)
    assert out["dry_run"] is True
    assert out["file_count"] == 2


def test_real_path_writes_manifest_last_with_cas_keys():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(
        policies=[
            {
                "id": 1,
                "handle": "privacy-policy",
                "title": "Privacy",
                "body": "<p>p</p>",
            },
            {
                "id": 2,
                "handle": "refund-policy",
                "title": "Refund",
                "body": "<p>r</p>",
            },
        ]
    )
    svc = PolicyPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    out = svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)

    cli.get_token.assert_called_once_with(SHOP)
    assert fake.constructed_with == (SHOP, "shpat_test")
    # 2 policy files via CAS + 1 manifest = 3 put_object calls.
    assert r2.put_object.call_count == 3
    keys = [c.args[0] for c in r2.put_object.call_args_list]
    # Pre-manifest keys all live under tenant CAS prefix.
    for k in keys[:-1]:
        assert k.startswith("tenants/1/cas/")
    assert keys[-1].endswith("manifest.json")
    assert out["file_count"] == 2

    manifest = json.loads(r2.put_object.call_args_list[-1].args[1].decode("utf-8"))
    assert manifest["version"] == 1
    paths = sorted(e["relative_path"] for e in manifest["entries"])
    assert paths == ["privacy-policy.json", "refund-policy.json"]


def test_admin_error_propagates():
    cli = MagicMock()
    cli.get_token.return_value = "shpat_test"
    r2 = _r2_with_miss()

    fake = _FakeAdmin(get_policies_error=ShopifyAdminError("boom: 500"))
    svc = PolicyPullService(
        shopify_cli=cli,
        r2_client=r2,
        admin_factory=_factory_for(fake),
        dry_run=False,
    )
    with pytest.raises(ShopifyAdminError) as excinfo:
        svc.pull(shop_domain=SHOP, tenant_id=1, store_id=3, snapshot_id=42)
    assert "boom" in str(excinfo.value)
    r2.put_object.assert_not_called()
