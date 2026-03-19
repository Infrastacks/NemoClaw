# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tests for the blueprint runner — plan/validate logic and protocol output."""

import re

import pytest

from orchestrator.runner import action_plan, emit_run_id


# --- emit_run_id ---


def test_emit_run_id_format(capsys):
    """Run ID must match nc-YYYYMMDD-HHMMSS-<8 hex chars> for downstream parsing."""
    rid = emit_run_id()
    assert re.fullmatch(r"nc-\d{8}-\d{6}-[0-9a-f]{8}", rid)


def test_emit_run_id_prints_protocol_line(capsys):
    """The TS plugin parses stdout for RUN_ID:<id> — verify the protocol line is emitted."""
    rid = emit_run_id()
    captured = capsys.readouterr()
    assert captured.out.strip() == f"RUN_ID:{rid}"


# --- action_plan with valid profile ---

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
    # Stub openshell_available so plan doesn't fail on CI
    monkeypatch.setattr("orchestrator.runner.openshell_available", lambda: True)

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
    monkeypatch.setattr("orchestrator.runner.openshell_available", lambda: True)

    plan = action_plan("local", VALID_BLUEPRINT, endpoint_url="http://ncp:9090/v1")

    assert plan["inference"]["endpoint"] == "http://ncp:9090/v1"


# --- action_plan with unknown profile ---


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
    monkeypatch.setattr("orchestrator.runner.openshell_available", lambda: True)

    plan = action_plan("ncp", NCP_BLUEPRINT, endpoint_url="https://ncp.example.com/v1")

    assert plan["inference"]["endpoint"] == "https://ncp.example.com/v1"
    assert plan["inference"]["provider_type"] == "ncp"
    assert plan["inference"]["model"] == "meta/llama-3.1-70b"


def test_action_plan_unknown_profile_exits(capsys):
    """Unknown profile must exit non-zero and list available profiles — this is the error
    path users actually hit when they typo a profile name."""
    with pytest.raises(SystemExit) as exc_info:
        action_plan("nonexistent", VALID_BLUEPRINT)

    assert exc_info.value.code == 1
    captured = capsys.readouterr()
    assert "nonexistent" in captured.out
    assert "local" in captured.out  # should list available profiles
