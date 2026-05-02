"""Tests for the Shopify CLI token client."""
from __future__ import annotations

import json
import subprocess
import threading
import time
from types import SimpleNamespace

import pytest

from app.clients import shopify_cli
from app.clients.shopify_cli import ShopifyCliClient, ShopifyCliError


SHOP = "demo.myshopify.com"


def _make_completed(stdout: str = "", stderr: str = "", returncode: int = 0):
    return SimpleNamespace(stdout=stdout, stderr=stderr, returncode=returncode)


def test_cache_hit_returns_cached_token(tmp_path, monkeypatch):
    cache_file = tmp_path / "cli-tokens.json"
    cache_file.write_text(
        json.dumps(
            {SHOP: {"token": "shpat_cached_value", "expires_at": time.time() + 3600}}
        )
    )

    def _explode(*_args, **_kwargs):
        raise AssertionError("subprocess.run must not be called on cache hit")

    monkeypatch.setattr(shopify_cli.subprocess, "run", _explode)

    client = ShopifyCliClient(cache_dir=cache_file)
    assert client.get_token(SHOP) == "shpat_cached_value"


def test_cache_miss_runs_subprocess(tmp_path, monkeypatch):
    cache_file = tmp_path / "cli-tokens.json"
    calls: list[list[str]] = []

    def _fake_run(cmd, **kwargs):
        calls.append(list(cmd))
        return _make_completed(stdout="Logged in successfully\nToken: shpat_abc123\n")

    monkeypatch.setattr(shopify_cli.subprocess, "run", _fake_run)

    client = ShopifyCliClient(cache_dir=cache_file)
    token = client.get_token(SHOP)

    assert token == "shpat_abc123"
    assert len(calls) == 1
    assert SHOP in calls[0]
    assert cache_file.exists()
    persisted = json.loads(cache_file.read_text())
    assert persisted[SHOP]["token"] == "shpat_abc123"
    assert persisted[SHOP]["expires_at"] > time.time()


def test_subprocess_failure_raises(tmp_path, monkeypatch):
    cache_file = tmp_path / "cli-tokens.json"

    def _fake_run(cmd, **kwargs):
        return _make_completed(stdout="", stderr="auth failed: not logged in", returncode=1)

    monkeypatch.setattr(shopify_cli.subprocess, "run", _fake_run)

    client = ShopifyCliClient(cache_dir=cache_file)
    with pytest.raises(ShopifyCliError) as excinfo:
        client.get_token(SHOP)
    assert "auth failed" in str(excinfo.value)


def test_concurrent_get_token_serialized(tmp_path, monkeypatch):
    cache_file = tmp_path / "cli-tokens.json"
    call_count = 0
    call_lock = threading.Lock()

    def _slow_run(cmd, **kwargs):
        nonlocal call_count
        with call_lock:
            call_count += 1
        time.sleep(0.2)
        return _make_completed(stdout="Token: shpat_concurrent\n")

    monkeypatch.setattr(shopify_cli.subprocess, "run", _slow_run)

    client = ShopifyCliClient(cache_dir=cache_file)
    results: list[str] = []
    errors: list[BaseException] = []

    def _worker():
        try:
            results.append(client.get_token(SHOP))
        except BaseException as exc:  # pragma: no cover - test diagnostics
            errors.append(exc)

    threads = [threading.Thread(target=_worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, errors
    assert results == ["shpat_concurrent", "shpat_concurrent"]
    assert call_count == 1
