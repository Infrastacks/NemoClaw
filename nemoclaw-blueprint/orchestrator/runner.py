#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
NemoClaw Blueprint Runner

Thin CLI wrapper around orchestrator.core.
Translates core results → stdout protocol lines and exit codes.

Protocol:
  - stdout lines starting with PROGRESS:<0-100>:<label> are parsed as progress updates
  - stdout line RUN_ID:<id> reports the run identifier
  - exit code 0 = success, non-zero = failure
"""

import argparse
import json
import sys

from orchestrator import core


def log(msg: str) -> None:
    print(msg, flush=True)


def progress(pct: int, label: str) -> None:
    print(f"PROGRESS:{pct}:{label}", flush=True)


def emit_run_id() -> str:
    rid = core.generate_run_id()
    print(f"RUN_ID:{rid}", flush=True)
    return rid


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
    """Plan deployment — wraps core.plan with protocol output."""
    rid = None
    try:
        result = core.plan(
            profile,
            blueprint,
            dry_run=dry_run,
            endpoint_url=endpoint_url,
            on_progress=progress,
        )
        rid = result["run_id"]
        print(f"RUN_ID:{rid}", flush=True)
        log(json.dumps(result, indent=2))
        return result
    except core.RunnerError as e:
        if rid:
            print(f"RUN_ID:{rid}", flush=True)
        log(f"ERROR: {e.message}")
        sys.exit(1)


def action_apply(
    profile: str,
    blueprint: dict,
    plan_path: str | None = None,
    endpoint_url: str | None = None,
) -> None:
    """Apply the plan — wraps core.apply with protocol output."""
    rid = None
    try:
        result = core.apply(
            profile,
            blueprint,
            plan_path=plan_path,
            endpoint_url=endpoint_url,
            on_progress=progress,
        )
        rid = result["run_id"]
        print(f"RUN_ID:{rid}", flush=True)
        log(result["message"])
    except core.RunnerError as e:
        if rid:
            print(f"RUN_ID:{rid}", flush=True)
        log(f"ERROR: {e.message}")
        sys.exit(1)


def action_status(rid: str | None = None) -> None:
    """Report run status — wraps core.status with protocol output."""
    emit_run_id()
    try:
        result = core.status(rid=rid)
        log(json.dumps(result) if isinstance(result, dict) else str(result))
    except core.RunnerError as e:
        log(f"ERROR: {e.message}")
        sys.exit(1)


def action_rollback(rid: str) -> None:
    """Rollback a run — wraps core.rollback with protocol output."""
    emit_run_id()
    try:
        result = core.rollback(rid, on_progress=progress)
        log(result["message"])
    except core.RunnerError as e:
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
