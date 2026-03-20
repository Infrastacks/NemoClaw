# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tests for the blueprint runner — plan/validate logic and telemetry output."""

import json
import re

import pytest

from orchestrator.runner import action_plan

# --- Valid blueprint fixture ---

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
    },
}


def test_action_plan_returns_correct_structure(monkeypatch, capsys):
    """Plan output must contain run_id, profile, sandbox config, and inference config."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)

    plan = action_plan("local", VALID_BLUEPRINT)

    assert re.fullmatch(r"nc-\d{8}-\d{6}-[0-9a-f]{8}", plan["run_id"])
    assert plan["profile"] == "local"
    assert plan["sandbox"]["image"] == "openclaw:latest"
    assert plan["sandbox"]["name"] == "test-sandbox"
    assert plan["sandbox"]["forward_ports"] == [18789, 3000]
    assert plan["inference"]["provider_type"] == "openai"
    assert plan["inference"]["model"] == "meta/llama-3.1-8b"
    assert plan["inference"]["endpoint"] == "http://localhost:8000/v1"


def test_action_plan_endpoint_override(monkeypatch, capsys):
    """When --endpoint-url is passed, it should override the profile's endpoint."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)

    plan = action_plan("local", VALID_BLUEPRINT, endpoint_url="http://ncp:9090/v1")

    assert plan["inference"]["endpoint"] == "http://ncp:9090/v1"


# --- NCP blueprint ---

NCP_BLUEPRINT = {
    "components": {
        "inference": {
            "profiles": {
                "ncp": {
                    "provider_type": "ncp",
                    "provider_name": "ncp-partner",
                    "endpoint": "",
                    "dynamic_endpoint": True,
                    "model": "meta/llama-3.1-70b",
                    "credential_env": "NCP_API_KEY",
                },
            },
        },
        "sandbox": {
            "image": "openclaw:latest",
            "name": "ncp-sandbox",
            "forward_ports": [18789],
        },
    },
}


def test_action_plan_with_ncp_profile(monkeypatch, capsys):
    """NCP profile with dynamic_endpoint must use the endpoint URL override."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)

    plan = action_plan("ncp", NCP_BLUEPRINT, endpoint_url="https://ncp.example.com/v1")

    assert plan["inference"]["endpoint"] == "https://ncp.example.com/v1"
    assert plan["inference"]["provider_type"] == "ncp"
    assert plan["inference"]["model"] == "meta/llama-3.1-70b"


def test_action_plan_unknown_profile_exits(capsys):
    """Unknown profile must exit non-zero and list available profiles."""
    with pytest.raises(SystemExit) as exc_info:
        action_plan("nonexistent", VALID_BLUEPRINT)

    assert exc_info.value.code == 1
    captured = capsys.readouterr()
    assert "nonexistent" in captured.out
    assert "local" in captured.out


# --- Telemetry event tests ---


def _parse_json_lines(output: str) -> list[dict]:
    """Extract all valid JSON objects from stdout lines."""
    import contextlib

    events = []
    for line in output.split("\n"):
        line = line.strip()
        if line.startswith("{"):
            with contextlib.suppress(json.JSONDecodeError):
                events.append(json.loads(line))
    return events


def test_action_plan_emits_telemetry_events(monkeypatch, capsys):
    """Plan action should emit structured JSON telemetry events."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)

    action_plan("local", VALID_BLUEPRINT)
    captured = capsys.readouterr()
    events = _parse_json_lines(captured.out)

    event_types = [e["eventType"] for e in events if "eventType" in e]
    assert "sandbox.progress" in event_types
    assert "sandbox.planned" in event_types
    assert "run.id" in event_types

    # Verify event structure
    for event in events:
        if "schemaVersion" in event:
            assert event["schemaVersion"] == "1.0"
            assert "timestamp" in event
            assert "sandboxId" in event


def test_action_plan_still_emits_legacy_lines(monkeypatch, capsys):
    """StdoutSink must emit legacy PROGRESS: and RUN_ID: lines for backward compat."""
    monkeypatch.setattr("orchestrator.core.openshell_available", lambda: True)

    result = action_plan("local", VALID_BLUEPRINT)
    captured = capsys.readouterr()

    assert f"RUN_ID:{result['run_id']}" in captured.out
    assert "PROGRESS:" in captured.out
