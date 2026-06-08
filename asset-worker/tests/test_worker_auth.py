from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def test_root_does_not_require_worker_token():
    resp = TestClient(app).get("/")

    assert resp.status_code == 200


def test_worker_api_requires_token(monkeypatch):
    monkeypatch.setattr(settings, "asset_worker_token", "secret")

    resp = TestClient(app).post("/pull/theme", json={})

    assert resp.status_code == 401


def test_worker_api_accepts_x_worker_token(monkeypatch):
    monkeypatch.setattr(settings, "asset_worker_token", "secret")

    resp = TestClient(app).post(
        "/pull/theme",
        headers={"X-Worker-Token": "secret"},
        json={},
    )

    assert resp.status_code == 422
