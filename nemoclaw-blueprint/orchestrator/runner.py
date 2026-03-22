#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
NemoClaw Blueprint Runner

Thin CLI wrapper around orchestrator.core.
Translates core results → structured telemetry events and exit codes.
Legacy PROGRESS: / RUN_ID: stdout lines are preserved via StdoutSink for
backward compatibility with exec.ts regex parsing.

Protocol:
  - stdout JSON lines are structured telemetry events (schemaVersion 1.0)
  - stdout lines starting with PROGRESS:<0-100>:<label> are emitted alongside JSON (legacy compat)
  - stdout line RUN_ID:<id> is emitted alongside JSON (legacy compat)
  - exit code 0 = success, non-zero = failure
"""

import argparse
import json
import sys

from orchestrator import core
from orchestrator.telemetry import (
    INFERENCE_CONFIGURED,
    POLICY_APPLIED,
    RUN_ID,
    SANDBOX_CREATED,
    SANDBOX_DESTROYED,
    SANDBOX_ERROR,
    SANDBOX_PLANNED,
    StdoutSink,
    TelemetryEmitter,
)


def log(msg: str) -> None:
    print(msg, flush=True)


def _cli_emitter() -> TelemetryEmitter:
    return TelemetryEmitter(sinks=[StdoutSink()])


def load_blueprint() -> dict:
    try:
        return core.load_blueprint()
    except core.RunnerError as e:
        log(f"ERROR: {e.message}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------


def action_plan(
    profile: str,
    blueprint: dict,
    *,
    dry_run: bool = False,
    endpoint_url: str | None = None,
) -> dict:
    """Plan deployment — wraps core.plan with telemetry output."""
    emitter = _cli_emitter()
    rid = None
    try:
        result = core.plan(
            profile,
            blueprint,
            dry_run=dry_run,
            endpoint_url=endpoint_url,
            on_progress=emitter.progress,
        )
        rid = result["run_id"]
        emitter.emit(RUN_ID, {"runId": rid})
        emitter.emit(SANDBOX_PLANNED, {"profile": profile, "runId": rid})
        log(json.dumps(result, indent=2))
        return result
    except core.RunnerError as e:
        if rid:
            emitter.emit(RUN_ID, {"runId": rid})
        emitter.emit(SANDBOX_ERROR, {"error": e.message})
        log(f"ERROR: {e.message}")
        sys.exit(1)


def action_apply(
    profile: str,
    blueprint: dict,
    plan_path: str | None = None,
    endpoint_url: str | None = None,
) -> None:
    """Apply the plan — wraps core.apply with telemetry output."""
    emitter = _cli_emitter()
    rid = None
    try:
        result = core.apply(
            profile,
            blueprint,
            plan_path=plan_path,
            endpoint_url=endpoint_url,
            on_progress=emitter.progress,
        )
        rid = result["run_id"]
        emitter.emit(RUN_ID, {"runId": rid})
        emitter.emit(SANDBOX_CREATED, {"sandboxName": result["sandbox_name"], "runId": rid})
        inf = result.get("inference", {})
        emitter.emit(
            INFERENCE_CONFIGURED,
            {
                "source": "inference",
                "provider": inf.get("provider_name", ""),
                "providerType": inf.get("provider_type", ""),
                "model": inf.get("model", ""),
                "endpoint": inf.get("endpoint", ""),
                "runId": rid,
            },
        )
        if result.get("policies_applied"):
            emitter.emit(
                POLICY_APPLIED,
                {
                    "source": "policy",
                    "policies": result["policies_applied"],
                    "runId": rid,
                },
            )
        log(result["message"])
    except core.RunnerError as e:
        if rid:
            emitter.emit(RUN_ID, {"runId": rid})
        emitter.emit(SANDBOX_ERROR, {"error": e.message})
        log(f"ERROR: {e.message}")
        sys.exit(1)


def action_status(rid: str | None = None) -> None:
    """Report run status — wraps core.status with protocol output."""
    try:
        result = core.status(rid=rid)
        log(json.dumps(result) if isinstance(result, dict) else str(result))
    except core.RunnerError as e:
        log(f"ERROR: {e.message}")
        sys.exit(1)


def action_rollback(rid: str) -> None:
    """Rollback a run — wraps core.rollback with telemetry output."""
    emitter = _cli_emitter()
    try:
        result = core.rollback(rid, on_progress=emitter.progress)
        emitter.emit(SANDBOX_DESTROYED, {"runId": rid})
        log(result["message"])
    except core.RunnerError as e:
        emitter.emit(SANDBOX_ERROR, {"error": e.message})
        log(f"ERROR: {e.message}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="NemoClaw Blueprint Runner")
    parser.add_argument("action", choices=["plan", "apply", "status", "rollback", "serve"])
    parser.add_argument("--profile", default="default")
    parser.add_argument("--plan", dest="plan_path")
    parser.add_argument("--run-id", dest="run_id")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--endpoint-url",
        dest="endpoint_url",
        default=None,
        help="Override endpoint URL for the selected profile",
    )

    args = parser.parse_args()

    if args.action == "serve":
        from orchestrator.server import start

        start()
        return

    blueprint = load_blueprint()

    if args.action == "plan":
        action_plan(args.profile, blueprint, dry_run=args.dry_run, endpoint_url=args.endpoint_url)
    elif args.action == "apply":
        action_apply(
            args.profile, blueprint, plan_path=args.plan_path, endpoint_url=args.endpoint_url
        )
    elif args.action == "status":
        action_status(rid=args.run_id)
    elif args.action == "rollback":
        if not args.run_id:
            log("ERROR: --run-id is required for rollback")
            sys.exit(1)
        action_rollback(args.run_id)


if __name__ == "__main__":
    main()
