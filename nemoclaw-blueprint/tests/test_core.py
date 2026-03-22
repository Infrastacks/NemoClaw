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
    SUBPROCESS_FAILED,
    RunnerError,
    describe_blueprint,
    generate_run_id,
    get_blueprint,
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


def test_apply_raises_when_provider_create_fails(monkeypatch, tmp_path):
    """Apply fails closed when provider creation fails."""
    responses = iter(
        [
            type("R", (), {"returncode": 0, "stderr": ""})(),
            type("R", (), {"returncode": 1, "stderr": "provider create failed"})(),
        ]
    )
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)
    monkeypatch.setattr("orchestrator.core.run_cmd", lambda *a, **kw: next(responses))

    from orchestrator.core import apply

    with pytest.raises(RunnerError) as exc_info:
        apply("local", VALID_BLUEPRINT)

    assert exc_info.value.code == SUBPROCESS_FAILED
    assert "create provider" in exc_info.value.message.lower()


def test_apply_raises_when_inference_set_fails(monkeypatch, tmp_path):
    """Apply fails closed when setting the inference route fails."""
    responses = iter(
        [
            type("R", (), {"returncode": 0, "stderr": ""})(),  # sandbox create
            type("R", (), {"returncode": 0, "stderr": ""})(),  # provider create
            type("R", (), {"returncode": 0, "stderr": ""})(),  # policy set
            type("R", (), {"returncode": 1, "stderr": "inference set failed"})(),  # inference set
        ]
    )
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)
    monkeypatch.setattr("orchestrator.core.run_cmd", lambda *a, **kw: next(responses))

    from orchestrator.core import apply

    with pytest.raises(RunnerError) as exc_info:
        apply("local", VALID_BLUEPRINT)

    assert exc_info.value.code == SUBPROCESS_FAILED
    assert "inference route" in exc_info.value.message.lower()


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


def test_apply_with_plan_path_persists_saved_profile(monkeypatch, tmp_path):
    """apply() with a saved plan persists that plan's profile instead of the request default."""
    import json

    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)
    monkeypatch.setattr(
        "orchestrator.core.run_cmd",
        lambda *a, **kw: type("R", (), {"returncode": 0, "stderr": ""})(),
    )

    from orchestrator.core import apply

    plan_result = plan("local", VALID_BLUEPRINT)
    apply("default", VALID_BLUEPRINT, plan_path=plan_result["run_id"])

    state_file = tmp_path / ".nemoclaw" / "state" / "runs" / plan_result["run_id"] / "plan.json"
    saved = json.loads(state_file.read_text())
    assert saved["profile"] == "local"


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


def test_get_blueprint_current_alias(monkeypatch):
    """get_blueprint accepts the current alias."""

    def fake_describe(path=None):
        return {"version": "0.2.0"}

    monkeypatch.setattr("orchestrator.core.describe_blueprint", fake_describe)
    assert get_blueprint("current") == {"version": "0.2.0"}


def test_get_blueprint_specific_version(monkeypatch):
    """get_blueprint accepts the currently loaded version."""

    def fake_describe(path=None):
        return {"version": "0.2.0"}

    monkeypatch.setattr("orchestrator.core.describe_blueprint", fake_describe)
    assert get_blueprint("0.2.0") == {"version": "0.2.0"}


# --- apply: inference return ---


def test_apply_returns_inference_config(monkeypatch, tmp_path):
    """apply() returns inference metadata in the result dict."""
    monkeypatch.setattr(
        "orchestrator.core.run_cmd",
        lambda *a, **kw: type("R", (), {"returncode": 0, "stderr": ""})(),
    )
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    from orchestrator.core import apply

    result = apply("local", VALID_BLUEPRINT)

    assert "inference" in result
    assert result["inference"]["provider_name"] == "local-nim"
    assert result["inference"]["provider_type"] == "openai"
    assert result["inference"]["model"] == "meta/llama-3.1-8b"
    assert result["inference"]["endpoint"] == "http://localhost:8000/v1"


# --- apply: policy application ---


def test_apply_applies_policies_on_success(monkeypatch, tmp_path):
    """apply() calls openshell policy set and returns applied policy names."""
    monkeypatch.setattr(
        "orchestrator.core.run_cmd",
        lambda *a, **kw: type("R", (), {"returncode": 0, "stderr": ""})(),
    )
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    from orchestrator.core import apply

    result = apply("local", VALID_BLUEPRINT)

    assert "policies_applied" in result
    assert result["policies_applied"] == ["nim_service"]


def test_apply_policy_failure_is_nonfatal(monkeypatch, tmp_path):
    """Policy set failure doesn't break apply — the policy is just not listed."""
    call_count = 0

    def mock_run_cmd(*a, **kw):
        nonlocal call_count
        call_count += 1
        args = a[0] if a else kw.get("args", [])
        # Fail on policy set (4th call: sandbox create, provider create, policy set, inference set)
        if "policy" in args and "set" in args:
            return type("R", (), {"returncode": 1, "stderr": "not supported"})()
        return type("R", (), {"returncode": 0, "stderr": ""})()

    monkeypatch.setattr("orchestrator.core.run_cmd", mock_run_cmd)
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    from orchestrator.core import apply

    result = apply("local", VALID_BLUEPRINT)

    assert result["policies_applied"] == []
    assert "ready" in result["message"]


def test_apply_no_policy_additions(monkeypatch, tmp_path):
    """apply() handles blueprints with no policy additions gracefully."""
    monkeypatch.setattr(
        "orchestrator.core.run_cmd",
        lambda *a, **kw: type("R", (), {"returncode": 0, "stderr": ""})(),
    )
    monkeypatch.setattr("orchestrator.core.Path.home", lambda: tmp_path)

    no_policy_bp = {
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
                "forward_ports": [18789],
            },
        },
    }

    from orchestrator.core import apply

    result = apply("local", no_policy_bp)

    assert result["policies_applied"] == []
