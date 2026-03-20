# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tests for the Blueprint REST API using FastAPI TestClient (in-process, no network)."""

import pytest
from fastapi.testclient import TestClient

from orchestrator.server import app

VALID_BLUEPRINT = {
    "components": {
        "inference": {
            "profiles": {
                "local": {
                    "provider_type": "openai",
                    "provider_name": "local-nim",
                    "endpoint": "http://localhost:8000/v1",
                    "model": "meta/llama-3.1-8b",
                    "credential_env": "NIM_API_KEY",
                },
                "default": {
                    "provider_type": "openai",
                    "provider_name": "default-nim",
                    "endpoint": "http://localhost:8000/v1",
                    "model": "meta/llama-3.1-8b",
                    "credential_env": "NIM_API_KEY",
                },
            },
        },
        "sandbox": {
            "image": "openclaw:latest",
            "name": "test-sandbox",
            "forward_ports": [18789],
        },
    },
}


@pytest.fixture
def client():
    return TestClient(app)


# --- health ---


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["version"] == "0.1.0"


# --- plan ---


def test_plan_valid(client, monkeypatch):
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)
    monkeypatch.setattr("orchestrator.core.load_blueprint", lambda path=None: VALID_BLUEPRINT)

    resp = client.post("/v1/blueprints/plan", json={"profile": "local"})
    assert resp.status_code == 200
    data = resp.json()
    assert "run_id" in data
    assert data["profile"] == "local"
    assert data["inference"]["provider_type"] == "openai"


def test_plan_unknown_profile(client, monkeypatch):
    monkeypatch.setattr("orchestrator.core.load_blueprint", lambda path=None: VALID_BLUEPRINT)

    resp = client.post("/v1/blueprints/plan", json={"profile": "nonexistent"})
    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert detail["code"] == "PROFILE_NOT_FOUND"


# --- apply ---


def test_apply_valid(client, monkeypatch, tmp_path):
    monkeypatch.setattr("orchestrator.core.load_blueprint", lambda path=None: VALID_BLUEPRINT)
    monkeypatch.setattr(
        "orchestrator.core.run_cmd",
        lambda *a, **kw: type("R", (), {"returncode": 0, "stderr": ""})(),
    )
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    resp = client.post("/v1/blueprints/apply", json={"profile": "local"})
    assert resp.status_code == 200
    data = resp.json()
    assert "run_id" in data
    assert data["sandbox_name"] == "test-sandbox"


# --- runs ---


def test_list_runs_empty(client, monkeypatch, tmp_path):
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    resp = client.get("/v1/runs")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_run_missing(client, monkeypatch, tmp_path):
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    resp = client.get("/v1/runs/nc-20260101-000000-deadbeef")
    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert detail["code"] == "RUN_NOT_FOUND"


def test_get_run(client, monkeypatch, tmp_path):
    """GET /v1/runs/{run_id} returns run data when plan.json exists."""
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    # Create a fake run
    run_id = "nc-20260101-120000-aabbccdd"
    run_dir = tmp_path / ".nemoclaw" / "state" / "runs" / run_id
    run_dir.mkdir(parents=True)
    import json

    (run_dir / "plan.json").write_text(
        json.dumps({"run_id": run_id, "profile": "local", "sandbox_name": "test"})
    )

    resp = client.get(f"/v1/runs/{run_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["run_id"] == run_id
    assert data["profile"] == "local"


# --- rollback ---


def test_rollback_missing(client, monkeypatch, tmp_path):
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    resp = client.post("/v1/runs/nc-20260101-000000-deadbeef/rollback")
    assert resp.status_code == 404


# --- stub endpoints ---


STUB_PATHS = [
    ("POST", "/v1/sandboxes"),
    ("GET", "/v1/sandboxes"),
    ("GET", "/v1/sandboxes/test-id"),
    ("POST", "/v1/sandboxes/test-id/start"),
    ("POST", "/v1/sandboxes/test-id/stop"),
    ("DELETE", "/v1/sandboxes/test-id"),
    ("GET", "/v1/policies"),
    ("POST", "/v1/sandboxes/test-id/policies"),
    ("POST", "/v1/sandboxes/test-id/restart"),
    ("DELETE", "/v1/sandboxes/test-id/policies/pol-1"),
    ("GET", "/v1/status"),
]


@pytest.mark.parametrize("method,path", STUB_PATHS)
def test_stub_endpoints_return_501(client, method, path):
    resp = client.request(method, path)
    assert resp.status_code == 501
    data = resp.json()
    assert data["code"] == "NOT_IMPLEMENTED"


# --- plan persistence (API level) ---


def test_apply_with_plan_not_found(client, monkeypatch, tmp_path):
    """POST /v1/blueprints/apply with nonexistent plan_path returns 404."""
    monkeypatch.setattr("orchestrator.core.load_blueprint", lambda path=None: VALID_BLUEPRINT)
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    resp = client.post(
        "/v1/blueprints/apply",
        json={"profile": "local", "plan_path": "nc-20260101-000000-nonexistent"},
    )
    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert detail["code"] == "PLAN_NOT_FOUND"


# --- blueprint metadata endpoints ---

DESCRIBE_META = {
    "version": "0.1.0",
    "description": "Test blueprint",
    "profiles": ["default", "ncp"],
    "sandbox": {"image": "openclaw:latest", "name": "openclaw"},
    "min_openshell": "0.1.0",
    "min_openclaw": "2026.3.0",
}


def test_list_blueprints(client, monkeypatch):
    """GET /v1/blueprints returns single-element array."""
    monkeypatch.setattr("orchestrator.core.describe_blueprint", lambda path=None: DESCRIBE_META)

    resp = client.get("/v1/blueprints")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["version"] == "0.1.0"
    assert data[0]["profiles"] == ["default", "ncp"]


def test_get_current_blueprint(client, monkeypatch):
    """GET /v1/blueprints/current returns full metadata."""
    monkeypatch.setattr("orchestrator.core.describe_blueprint", lambda path=None: DESCRIBE_META)

    resp = client.get("/v1/blueprints/current")
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == "0.1.0"
    assert data["sandbox"]["image"] == "openclaw:latest"
    assert data["min_openshell"] == "0.1.0"
    assert data["min_openclaw"] == "2026.3.0"


def test_get_blueprint_by_version(client, monkeypatch):
    """GET /v1/blueprints/{version} returns current metadata for the active version."""
    monkeypatch.setattr("orchestrator.core.get_blueprint", lambda version, path=None: DESCRIBE_META)

    resp = client.get("/v1/blueprints/0.1.0")
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == "0.1.0"
    assert data["sandbox"]["name"] == "openclaw"


def test_get_blueprint_current_alias_route(client, monkeypatch):
    """GET /v1/blueprints/current remains supported as a compatibility alias."""
    monkeypatch.setattr("orchestrator.core.get_blueprint", lambda version, path=None: DESCRIBE_META)

    resp = client.get("/v1/blueprints/current")
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == "0.1.0"
