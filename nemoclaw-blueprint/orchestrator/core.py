# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Core blueprint orchestration logic.

Pure functions that return dicts and raise RunnerError on failure.
No print() or sys.exit() calls — those belong in the CLI wrapper (runner.py)
or the API layer (server.py).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml


class RunnerError(Exception):
    """Structured error with a machine-readable code for HTTP status mapping."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# Error codes
PROFILE_NOT_FOUND = "PROFILE_NOT_FOUND"
OPENSHELL_UNAVAILABLE = "OPENSHELL_UNAVAILABLE"
RUN_NOT_FOUND = "RUN_NOT_FOUND"
BLUEPRINT_NOT_FOUND = "BLUEPRINT_NOT_FOUND"
SUBPROCESS_FAILED = "SUBPROCESS_FAILED"
PLAN_NOT_FOUND = "PLAN_NOT_FOUND"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def generate_run_id() -> str:
    """Generate a run ID in the format nc-YYYYMMDD-HHMMSS-<8hex>."""
    return f"nc-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}"


def run_cmd(
    args: list[str],
    *,
    check: bool = True,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run a command as an argv list (never shell=True)."""
    return subprocess.run(
        args,
        check=check,
        capture_output=capture,
        text=True,
    )


def openshell_available() -> bool:
    """Check if openshell CLI is available."""
    return shutil.which("openshell") is not None


def _plans_dir() -> Path:
    """Directory for saved plans."""
    return Path.home() / ".nemoclaw" / "state" / "plans"


def _plan_path_for_run(run_id: str) -> Path:
    """Path to saved plan JSON for a given run_id."""
    return _plans_dir() / run_id / "plan.json"


def load_plan(plan_ref: str) -> dict[str, Any]:
    """Load a saved plan by run_id or file path.

    Raises RunnerError(PLAN_NOT_FOUND) if missing.
    """
    # Try as direct file path first
    ref_path = Path(plan_ref)
    if ref_path.is_file():
        return json.loads(ref_path.read_text())

    # Try as run_id
    plan_file = _plan_path_for_run(plan_ref)
    if plan_file.is_file():
        return json.loads(plan_file.read_text())

    raise RunnerError(PLAN_NOT_FOUND, f"Plan not found: {plan_ref}")


def load_blueprint(path: str | None = None) -> dict[str, Any]:
    """Load blueprint.yaml from the given path or NEMOCLAW_BLUEPRINT_PATH env var."""
    blueprint_path = Path(path) if path else Path(os.environ.get("NEMOCLAW_BLUEPRINT_PATH", "."))
    bp_file = blueprint_path / "blueprint.yaml"
    if not bp_file.exists():
        raise RunnerError(BLUEPRINT_NOT_FOUND, f"blueprint.yaml not found at {bp_file}")
    with bp_file.open() as f:
        return yaml.safe_load(f)


def describe_blueprint(path: str | None = None) -> dict[str, Any]:
    """Extract top-level metadata from blueprint.yaml."""
    bp = load_blueprint(path)
    sandbox_cfg = bp.get("components", {}).get("sandbox", {})
    return {
        "version": bp.get("version", "unknown"),
        "description": (bp.get("description") or "").strip(),
        "profiles": bp.get("profiles", []),
        "sandbox": {
            "image": sandbox_cfg.get("image", ""),
            "name": sandbox_cfg.get("name", ""),
        },
        "min_openshell": bp.get("min_openshell_version", ""),
        "min_openclaw": bp.get("min_openclaw_version", ""),
    }


def get_blueprint(version: str, path: str | None = None) -> dict[str, Any]:
    """Return the current blueprint metadata for the supported version selectors."""
    meta = describe_blueprint(path)
    if version in {"current", meta["version"]}:
        return meta

    raise RunnerError(BLUEPRINT_NOT_FOUND, f"Blueprint version '{version}' not found.")


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

ProgressCallback = Callable[[int, str], None] | None


def plan(
    profile: str,
    blueprint: dict[str, Any],
    *,
    dry_run: bool = False,
    endpoint_url: str | None = None,
    on_progress: ProgressCallback = None,
) -> dict[str, Any]:
    """Plan the deployment: validate inputs, resolve profile, check prerequisites."""
    rid = generate_run_id()

    if on_progress:
        on_progress(10, "Validating blueprint")

    inference_profiles: dict[str, Any] = (
        blueprint.get("components", {}).get("inference", {}).get("profiles", {})
    )
    if profile not in inference_profiles:
        available = ", ".join(inference_profiles.keys())
        raise RunnerError(
            PROFILE_NOT_FOUND,
            f"Profile '{profile}' not found. Available: {available}",
        )

    if on_progress:
        on_progress(20, "Checking prerequisites")

    if not openshell_available():
        raise RunnerError(
            OPENSHELL_UNAVAILABLE,
            "openshell CLI not found. Install OpenShell first. "
            "See: https://github.com/NVIDIA/OpenShell",
        )

    sandbox_cfg: dict[str, Any] = blueprint.get("components", {}).get("sandbox", {})
    inference_cfg: dict[str, Any] = inference_profiles[profile]

    # Override endpoint if provided (e.g., NCP dynamic endpoint)
    if endpoint_url:
        inference_cfg = {**inference_cfg, "endpoint": endpoint_url}

    result: dict[str, Any] = {
        "run_id": rid,
        "profile": profile,
        "sandbox": {
            "image": sandbox_cfg.get("image", "openclaw"),
            "name": sandbox_cfg.get("name", "openclaw"),
            "forward_ports": sandbox_cfg.get("forward_ports", [18789]),
        },
        "inference": {
            "provider_type": inference_cfg.get("provider_type"),
            "provider_name": inference_cfg.get("provider_name"),
            "endpoint": inference_cfg.get("endpoint"),
            "model": inference_cfg.get("model"),
            "credential_env": inference_cfg.get("credential_env"),
        },
        "policy_additions": (
            blueprint.get("components", {}).get("policy", {}).get("additions", {})
        ),
        "dry_run": dry_run,
    }

    # Persist plan to disk for later apply
    plan_file = _plan_path_for_run(rid)
    plan_file.parent.mkdir(parents=True, exist_ok=True)
    plan_file.write_text(json.dumps(result, indent=2))

    if on_progress:
        on_progress(100, "Plan complete")

    return result


def apply(
    profile: str,
    blueprint: dict[str, Any],
    *,
    plan_path: str | None = None,
    endpoint_url: str | None = None,
    on_progress: ProgressCallback = None,
) -> dict[str, Any]:
    """Apply the plan: create sandbox, configure provider, set inference route."""
    if plan_path:
        saved = load_plan(plan_path)
        rid = saved["run_id"]
        resolved_profile = saved.get("profile", profile)
        sandbox_cfg = saved.get("sandbox", {})
        inference_cfg = saved.get("inference", {})
    else:
        rid = generate_run_id()
        resolved_profile = profile
        inference_profiles: dict[str, Any] = (
            blueprint.get("components", {}).get("inference", {}).get("profiles", {})
        )
        inference_cfg = inference_profiles.get(profile, {})
        sandbox_cfg = blueprint.get("components", {}).get("sandbox", {})

    # Override endpoint if provided (e.g., NCP dynamic endpoint)
    if endpoint_url:
        inference_cfg = {**inference_cfg, "endpoint": endpoint_url}

    sandbox_name: str = sandbox_cfg.get("name", "openclaw")
    sandbox_image: str = sandbox_cfg.get("image", "openclaw")
    forward_ports: list[int] = sandbox_cfg.get("forward_ports", [18789])

    # Step 1: Create sandbox
    if on_progress:
        on_progress(20, "Creating OpenClaw sandbox")

    create_args = [
        "openshell",
        "sandbox",
        "create",
        "--from",
        sandbox_image,
        "--name",
        sandbox_name,
    ]
    for port in forward_ports:
        create_args.extend(["--forward", str(port)])

    result = run_cmd(create_args, check=False, capture=True)
    if result.returncode != 0:
        if "already exists" in (result.stderr or ""):
            pass  # Reuse existing sandbox
        else:
            raise RunnerError(
                SUBPROCESS_FAILED,
                f"Failed to create sandbox: {result.stderr}",
            )

    # Step 2: Configure inference provider
    if on_progress:
        on_progress(50, "Configuring inference provider")

    provider_name: str = inference_cfg.get("provider_name", "default")
    provider_type: str = inference_cfg.get("provider_type", "openai")
    endpoint: str = inference_cfg.get("endpoint", "")
    model: str = inference_cfg.get("model", "")

    # Resolve credential from environment
    credential_env = inference_cfg.get("credential_env")
    credential_default: str = inference_cfg.get("credential_default", "")
    credential = ""
    if credential_env:
        credential = os.environ.get(credential_env, credential_default)

    provider_args = [
        "openshell",
        "provider",
        "create",
        "--name",
        provider_name,
        "--type",
        provider_type,
    ]
    if credential:
        provider_args.extend(["--credential", f"OPENAI_API_KEY={credential}"])
    if endpoint:
        provider_args.extend(["--config", f"OPENAI_BASE_URL={endpoint}"])

    provider_result = run_cmd(provider_args, check=False, capture=True)
    if provider_result.returncode != 0:
        stderr = provider_result.stderr or ""
        if "already exists" in stderr.lower():
            update_args = [
                "openshell",
                "provider",
                "update",
                provider_name,
            ]
            if credential:
                update_args.extend(["--credential", f"OPENAI_API_KEY={credential}"])
            if endpoint:
                update_args.extend(["--config", f"OPENAI_BASE_URL={endpoint}"])

            update_result = run_cmd(update_args, check=False, capture=True)
            if update_result.returncode != 0:
                raise RunnerError(
                    SUBPROCESS_FAILED,
                    f"Failed to update provider: {update_result.stderr}",
                )
        else:
            raise RunnerError(
                SUBPROCESS_FAILED,
                f"Failed to create provider: {provider_result.stderr}",
            )

    # Step 2.5: Apply policy additions (non-fatal — OpenShell may not support this yet)
    if on_progress:
        on_progress(55, "Applying policy additions")

    policy_additions: dict[str, Any] = (
        saved.get("policy_additions", {})
        if plan_path
        else blueprint.get("components", {}).get("policy", {}).get("additions", {})
    )
    applied_policies: list[str] = []
    for policy_name, policy_cfg in policy_additions.items():
        policy_result = run_cmd(
            [
                "openshell",
                "policy",
                "set",
                "--name",
                policy_name,
                "--config",
                json.dumps(policy_cfg),
            ],
            check=False,
            capture=True,
        )
        if policy_result.returncode == 0:
            applied_policies.append(policy_name)

    # Step 3: Set inference route
    if on_progress:
        on_progress(70, "Setting inference route")

    inference_result = run_cmd(
        ["openshell", "inference", "set", "--provider", provider_name, "--model", model],
        check=False,
        capture=True,
    )
    if inference_result.returncode != 0:
        raise RunnerError(
            SUBPROCESS_FAILED,
            f"Failed to set inference route: {inference_result.stderr}",
        )

    # Step 4: Save run state
    if on_progress:
        on_progress(85, "Saving run state")

    state_dir = Path.home() / ".nemoclaw" / "state" / "runs" / rid
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "plan.json").write_text(
        json.dumps(
            {
                "run_id": rid,
                "profile": resolved_profile,
                "sandbox_name": sandbox_name,
                "inference": inference_cfg,
                "timestamp": datetime.now(UTC).isoformat(),
            },
            indent=2,
        )
    )

    if on_progress:
        on_progress(100, "Apply complete")

    return {
        "run_id": rid,
        "sandbox_name": sandbox_name,
        "inference": {
            "provider_name": provider_name,
            "provider_type": provider_type,
            "model": model,
            "endpoint": endpoint,
        },
        "policies_applied": applied_policies,
        "message": f"Sandbox '{sandbox_name}' is ready. "
        f"Inference: {provider_name} -> {model} @ {endpoint}",
    }


def status(rid: str | None = None) -> dict[str, Any]:
    """Report current state of the most recent (or specified) run."""
    state_dir = Path.home() / ".nemoclaw" / "state" / "runs"

    if rid:
        run_dir = state_dir / rid
        if not run_dir.exists():
            raise RunnerError(RUN_NOT_FOUND, f"Run {rid} not found.")
    else:
        if not state_dir.exists():
            raise RunnerError(RUN_NOT_FOUND, "No runs found.")
        runs = sorted(state_dir.iterdir(), reverse=True)
        if not runs:
            raise RunnerError(RUN_NOT_FOUND, "No runs found.")
        run_dir = runs[0]

    plan_file = run_dir / "plan.json"
    if plan_file.exists():
        return json.loads(plan_file.read_text())

    return {"run_id": run_dir.name, "status": "unknown"}


def list_runs() -> list[dict[str, Any]]:
    """List all runs."""
    state_dir = Path.home() / ".nemoclaw" / "state" / "runs"
    if not state_dir.exists():
        return []

    results: list[dict[str, Any]] = []
    for run_dir in sorted(state_dir.iterdir(), reverse=True):
        plan_file = run_dir / "plan.json"
        if plan_file.exists():
            results.append(json.loads(plan_file.read_text()))
        else:
            results.append({"run_id": run_dir.name, "status": "unknown"})
    return results


def rollback(rid: str, *, on_progress: ProgressCallback = None) -> dict[str, Any]:
    """Rollback a specific run: stop sandbox, remove provider config."""
    state_dir = Path.home() / ".nemoclaw" / "state" / "runs" / rid
    if not state_dir.exists():
        raise RunnerError(RUN_NOT_FOUND, f"Run {rid} not found.")

    plan_file = state_dir / "plan.json"
    if plan_file.exists():
        run_plan = json.loads(plan_file.read_text())
        sandbox_name = run_plan.get("sandbox_name", "openclaw")

        if on_progress:
            on_progress(30, f"Stopping sandbox {sandbox_name}")
        run_cmd(
            ["openshell", "sandbox", "stop", sandbox_name],
            check=False,
            capture=True,
        )

        if on_progress:
            on_progress(60, f"Removing sandbox {sandbox_name}")
        run_cmd(
            ["openshell", "sandbox", "remove", sandbox_name],
            check=False,
            capture=True,
        )

    if on_progress:
        on_progress(90, "Cleaning up run state")
    (state_dir / "rolled_back").write_text(datetime.now(UTC).isoformat())

    if on_progress:
        on_progress(100, "Rollback complete")

    return {"run_id": rid, "message": f"Run {rid} rolled back."}
