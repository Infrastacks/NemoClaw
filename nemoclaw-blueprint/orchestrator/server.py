# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
NemoClaw Blueprint REST API

FastAPI server wrapping orchestrator.core functions.
Entry point: ``python -m orchestrator.server`` or ``runner.py serve``.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from orchestrator import core
from orchestrator.models import (
    ApplyRequest,
    ApplyResponse,
    BlueprintDescribeResponse,
    BlueprintSummary,
    ErrorResponse,
    HealthResponse,
    PlanRequest,
    PlanResponse,
    RollbackResponse,
    RunStatusResponse,
)
from orchestrator.telemetry import (
    SANDBOX_CREATED,
    SANDBOX_DESTROYED,
    SANDBOX_ERROR,
    SANDBOX_PLANNED,
    FileSink,
    TelemetryEmitter,
)

app = FastAPI(
    title="NemoClaw Blueprint API",
    version="0.1.0",
    description="REST API for NemoClaw blueprint orchestration",
)


# ---------------------------------------------------------------------------
# Error-code → HTTP-status mapping
# ---------------------------------------------------------------------------

_ERROR_STATUS: dict[str, int] = {
    core.PROFILE_NOT_FOUND: 404,
    core.OPENSHELL_UNAVAILABLE: 503,
    core.RUN_NOT_FOUND: 404,
    core.BLUEPRINT_NOT_FOUND: 404,
    core.SUBPROCESS_FAILED: 502,
    core.PLAN_NOT_FOUND: 404,
}


def _server_emitter() -> TelemetryEmitter:
    return TelemetryEmitter(sinks=[FileSink()])


def _handle_runner_error(exc: core.RunnerError) -> HTTPException:
    status = _ERROR_STATUS.get(exc.code, 500)
    return HTTPException(
        status_code=status,
        detail=ErrorResponse(error=exc.message, code=exc.code).model_dump(),
    )


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


# ---------------------------------------------------------------------------
# Blueprint endpoints (implemented)
# ---------------------------------------------------------------------------


@app.get("/v1/blueprints", response_model=list[BlueprintSummary])
def list_blueprints() -> list[BlueprintSummary]:
    try:
        meta = core.describe_blueprint()
        return [
            BlueprintSummary(
                version=meta["version"],
                description=meta["description"],
                profiles=meta["profiles"],
            )
        ]
    except core.RunnerError as exc:
        raise _handle_runner_error(exc) from exc


@app.get("/v1/blueprints/current", response_model=BlueprintDescribeResponse)
def get_current_blueprint() -> BlueprintDescribeResponse:
    try:
        meta = core.get_blueprint("current")
        return BlueprintDescribeResponse(**meta)
    except core.RunnerError as exc:
        raise _handle_runner_error(exc) from exc


@app.get("/v1/blueprints/{version}", response_model=BlueprintDescribeResponse)
def get_blueprint(version: str) -> BlueprintDescribeResponse:
    try:
        meta = core.get_blueprint(version)
        return BlueprintDescribeResponse(**meta)
    except core.RunnerError as exc:
        raise _handle_runner_error(exc) from exc


@app.post("/v1/blueprints/plan", response_model=PlanResponse)
def blueprint_plan(req: PlanRequest) -> PlanResponse:
    emitter = _server_emitter()
    try:
        blueprint = core.load_blueprint()
        result = core.plan(
            req.profile,
            blueprint,
            dry_run=req.dry_run,
            endpoint_url=req.endpoint_url,
            on_progress=emitter.progress,
        )
        emitter.emit(SANDBOX_PLANNED, {"profile": req.profile, "runId": result["run_id"]})
        return PlanResponse(**result)
    except core.RunnerError as exc:
        emitter.emit(SANDBOX_ERROR, {"error": exc.message})
        raise _handle_runner_error(exc) from exc


@app.post("/v1/blueprints/apply", response_model=ApplyResponse)
def blueprint_apply(req: ApplyRequest) -> ApplyResponse:
    emitter = _server_emitter()
    try:
        blueprint = core.load_blueprint()
        result = core.apply(
            req.profile,
            blueprint,
            plan_path=req.plan_path,
            endpoint_url=req.endpoint_url,
            on_progress=emitter.progress,
        )
        emitter.emit(
            SANDBOX_CREATED, {"sandboxName": result["sandbox_name"], "runId": result["run_id"]}
        )
        return ApplyResponse(**result)
    except core.RunnerError as exc:
        emitter.emit(SANDBOX_ERROR, {"error": exc.message})
        raise _handle_runner_error(exc) from exc


# ---------------------------------------------------------------------------
# Run endpoints (implemented)
# ---------------------------------------------------------------------------


@app.get("/v1/runs", response_model=list[RunStatusResponse])
def get_runs() -> list[RunStatusResponse]:
    results = core.list_runs()
    return [RunStatusResponse(**r) for r in results]


@app.get("/v1/runs/{run_id}", response_model=RunStatusResponse)
def get_run(run_id: str) -> RunStatusResponse:
    try:
        result = core.status(rid=run_id)
        return RunStatusResponse(**result)
    except core.RunnerError as exc:
        raise _handle_runner_error(exc) from exc


@app.post("/v1/runs/{run_id}/rollback", response_model=RollbackResponse)
def run_rollback(run_id: str) -> RollbackResponse:
    emitter = _server_emitter()
    try:
        result = core.rollback(run_id, on_progress=emitter.progress)
        emitter.emit(SANDBOX_DESTROYED, {"runId": run_id})
        return RollbackResponse(**result)
    except core.RunnerError as exc:
        emitter.emit(SANDBOX_ERROR, {"error": exc.message})
        raise _handle_runner_error(exc) from exc


# ---------------------------------------------------------------------------
# Stub endpoints (501 Not Implemented)
# ---------------------------------------------------------------------------

_STUB_MSG = "Not implemented — requires OpenShell SDK"
_POLICY_STUB_MSG = "Not implemented — future"


def _stub_response(msg: str = _STUB_MSG) -> JSONResponse:
    return JSONResponse(
        status_code=501,
        content=ErrorResponse(error=msg, code="NOT_IMPLEMENTED").model_dump(),
    )


@app.post("/v1/sandboxes")
def create_sandbox() -> JSONResponse:
    return _stub_response()


@app.get("/v1/sandboxes")
def list_sandboxes() -> JSONResponse:
    return _stub_response()


@app.get("/v1/sandboxes/{sandbox_id}")
def get_sandbox(sandbox_id: str) -> JSONResponse:
    return _stub_response()


@app.post("/v1/sandboxes/{sandbox_id}/start")
def start_sandbox(sandbox_id: str) -> JSONResponse:
    return _stub_response()


@app.post("/v1/sandboxes/{sandbox_id}/stop")
def stop_sandbox(sandbox_id: str) -> JSONResponse:
    return _stub_response()


@app.delete("/v1/sandboxes/{sandbox_id}")
def delete_sandbox(sandbox_id: str) -> JSONResponse:
    return _stub_response()


@app.get("/v1/policies")
def list_policies() -> JSONResponse:
    return _stub_response(_POLICY_STUB_MSG)


@app.post("/v1/sandboxes/{sandbox_id}/policies")
def attach_policy(sandbox_id: str) -> JSONResponse:
    return _stub_response(_POLICY_STUB_MSG)


@app.post("/v1/sandboxes/{sandbox_id}/restart")
def restart_sandbox(sandbox_id: str) -> JSONResponse:
    return _stub_response()


@app.delete("/v1/sandboxes/{sandbox_id}/policies/{policy_id}")
def detach_policy(sandbox_id: str, policy_id: str) -> JSONResponse:
    return _stub_response(_POLICY_STUB_MSG)


@app.get("/v1/status")
def system_status() -> JSONResponse:
    return _stub_response("Not implemented — future")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def start(host: str = "127.0.0.1", port: int = 18790) -> None:
    import uvicorn

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    start()
