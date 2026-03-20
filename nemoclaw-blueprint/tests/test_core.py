# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tests for orchestrator.core — pure logic layer without CLI side effects."""

import re

import pytest

from orchestrator.core import (
    OPENSHELL_UNAVAILABLE,
    PLAN_NOT_FOUND,
    PROFILE_NOT_FOUND,
    RUN_NOT_FOUND,
    RunnerError,
    describe_blueprint,
    generate_run_id,
    list_runs,
    load_plan,
    plan,
    rollback,
    status,
)

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
            },
        },
        "sandbox": {
            "image": "openclaw:latest",
            "name": "test-sandbox",
            "forward_ports": [18789, 3000],
        },
        "policy": {
            "additions": {"nim_service": {"host": "nim-service.local"}},
        },
    },
}


# --- generate_run_id ---


def test_generate_run_id_format():
    """Run ID matches nc-YYYYMMDD-HHMMSS-<8hex> — no stdout side effects."""
    rid = generate_run_id()
    assert re.fullmatch(r"nc-\d{8}-\d{6}-[0-9a-f]{8}", rid)


# --- plan ---


def test_plan_valid_profile(monkeypatch):
    """Plan returns correct dict structure for a valid profile."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)

    result = plan("local", VALID_BLUEPRINT)

    assert re.fullmatch(r"nc-\d{8}-\d{6}-[0-9a-f]{8}", result["run_id"])
    assert result["profile"] == "local"
    assert result["sandbox"]["image"] == "openclaw:latest"
    assert result["sandbox"]["name"] == "test-sandbox"
    assert result["sandbox"]["forward_ports"] == [18789, 3000]
    assert result["inference"]["provider_type"] == "openai"
    assert result["inference"]["model"] == "meta/llama-3.1-8b"
    assert result["inference"]["endpoint"] == "http://localhost:8000/v1"
    assert result["dry_run"] is False


def test_plan_unknown_profile_raises():
    """Unknown profile raises RunnerError with PROFILE_NOT_FOUND code."""
    with pytest.raises(RunnerError) as exc_info:
        plan("nonexistent", VALID_BLUEPRINT)

    assert exc_info.value.code == PROFILE_NOT_FOUND
    assert "nonexistent" in exc_info.value.message
    assert "local" in exc_info.value.message  # lists available profiles


def test_plan_openshell_unavailable_raises(monkeypatch):
    """Raises RunnerError with OPENSHELL_UNAVAILABLE when openshell is missing."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: False)

    with pytest.raises(RunnerError) as exc_info:
        plan("local", VALID_BLUEPRINT)

    assert exc_info.value.code == OPENSHELL_UNAVAILABLE


def test_plan_endpoint_override(monkeypatch):
    """endpoint_url overrides the profile's endpoint in the result."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)

    result = plan("local", VALID_BLUEPRINT, endpoint_url="http://ncp:9090/v1")

    assert result["inference"]["endpoint"] == "http://ncp:9090/v1"


def test_plan_progress_callback(monkeypatch):
    """on_progress callback is invoked with expected (pct, label) tuples."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)
    calls: list[tuple[int, str]] = []

    plan("local", VALID_BLUEPRINT, on_progress=lambda pct, label: calls.append((pct, label)))

    assert len(calls) == 3
    assert calls[0] == (10, "Validating blueprint")
    assert calls[1] == (20, "Checking prerequisites")
    assert calls[2] == (100, "Plan complete")


# --- apply ---


def test_apply_returns_result(monkeypatch, tmp_path):
    """Apply returns dict with run_id, sandbox_name, and message."""
    monkeypatch.setattr(
        "orchestrator.core.run_cmd",
        lambda *a, **kw: type("R", (), {"returncode": 0, "stderr": ""})(),
    )
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    from orchestrator.core import apply

    result = apply("local", VALID_BLUEPRINT)

    assert re.fullmatch(r"nc-\d{8}-\d{6}-[0-9a-f]{8}", result["run_id"])
    assert result["sandbox_name"] == "test-sandbox"
    assert "ready" in result["message"]


# --- status ---


def test_status_no_runs_raises(monkeypatch, tmp_path):
    """Raises RUN_NOT_FOUND when no runs directory exists."""
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    with pytest.raises(RunnerError) as exc_info:
        status()

    assert exc_info.value.code == RUN_NOT_FOUND


# --- list_runs ---


def test_list_runs_empty(monkeypatch, tmp_path):
    """Returns empty list when no state directory exists."""
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    result = list_runs()

    assert result == []


# --- rollback ---


def test_rollback_missing_run_raises(monkeypatch, tmp_path):
    """Raises RUN_NOT_FOUND for a nonexistent run ID."""
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    with pytest.raises(RunnerError) as exc_info:
        rollback("nc-20260101-000000-deadbeef")

    assert exc_info.value.code == RUN_NOT_FOUND


# --- plan persistence ---


def test_plan_saves_to_disk(monkeypatch, tmp_path):
    """plan() persists plan.json at the correct path."""
    import json

    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    result = plan("local", VALID_BLUEPRINT)

    plan_file = tmp_path / ".nemoclaw" / "state" / "plans" / result["run_id"] / "plan.json"
    assert plan_file.exists()
    saved = json.loads(plan_file.read_text())
    assert saved["run_id"] == result["run_id"]
    assert saved["profile"] == "local"
    assert saved["sandbox"]["image"] == "openclaw:latest"


def test_apply_with_plan_path_reuses_run_id(monkeypatch, tmp_path):
    """apply() with plan_path reuses the run_id from the saved plan."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)
    monkeypatch.setattr(
        "orchestrator.core.run_cmd",
        lambda *a, **kw: type("R", (), {"returncode": 0, "stderr": ""})(),
    )

    from orchestrator.core import apply

    plan_result = plan("local", VALID_BLUEPRINT)
    apply_result = apply("local", VALID_BLUEPRINT, plan_path=plan_result["run_id"])

    assert apply_result["run_id"] == plan_result["run_id"]


def test_apply_with_plan_path_uses_plan_config(monkeypatch, tmp_path):
    """apply() with plan_path uses sandbox/inference config from saved plan, not blueprint args."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)
    monkeypatch.setattr(
        "orchestrator.core.run_cmd",
        lambda *a, **kw: type("R", (), {"returncode": 0, "stderr": ""})(),
    )

    from orchestrator.core import apply

    plan_result = plan("local", VALID_BLUEPRINT)
    # Pass an empty blueprint — apply should use the saved plan's config, not this
    apply_result = apply("local", {"components": {}}, plan_path=plan_result["run_id"])

    assert apply_result["sandbox_name"] == "test-sandbox"


def test_load_plan_not_found_raises(monkeypatch, tmp_path):
    """load_plan raises RunnerError(PLAN_NOT_FOUND) for nonexistent ref."""
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    with pytest.raises(RunnerError) as exc_info:
        load_plan("nc-20260101-000000-nonexistent")

    assert exc_info.value.code == PLAN_NOT_FOUND


# --- describe_blueprint ---


def test_describe_blueprint(monkeypatch):
    """describe_blueprint extracts top-level metadata from blueprint.yaml."""
    fake_bp = {
        "version": "0.2.0",
        "description": "Test blueprint\n",
        "profiles": ["default", "nim-local"],
        "min_openshell_version": "0.1.0",
        "min_openclaw_version": "2026.3.0",
        "components": {
            "sandbox": {"image": "openclaw:latest", "name": "openclaw"},
            "inference": {"profiles": {}},
        },
    }
    monkeypatch.setattr("orchestrator.core.load_blueprint", lambda path=None: fake_bp)

    result = describe_blueprint()

    assert result["version"] == "0.2.0"
    assert result["description"] == "Test blueprint"
    assert result["profiles"] == ["default", "nim-local"]
    assert result["sandbox"]["image"] == "openclaw:latest"
    assert result["min_openshell"] == "0.1.0"
    assert result["min_openclaw"] == "2026.3.0"
