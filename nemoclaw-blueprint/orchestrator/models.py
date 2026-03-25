# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Pydantic request/response models for the Blueprint REST API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"


class PlanResponse(BaseModel):
    run_id: str
    profile: str
    sandbox: dict
    inference: dict
    policy_additions: dict | None = None
    dry_run: bool = False


class ApplyResponse(BaseModel):
    run_id: str
    sandbox_name: str
    message: str


class RunStatusResponse(BaseModel):
    run_id: str
    profile: str | None = None
    sandbox_name: str | None = None
    inference: dict | None = None
    timestamp: str | None = None
    status: str | None = None


class RollbackResponse(BaseModel):
    run_id: str
    message: str


class BlueprintSummary(BaseModel):
    version: str
    description: str
    profiles: list[str]


class BlueprintDescribeResponse(BaseModel):
    version: str
    description: str
    profiles: list[str]
    sandbox: dict
    min_openshell: str
    min_openclaw: str


class ErrorResponse(BaseModel):
    error: str
    code: str
    detail: str | None = None


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class PlanRequest(BaseModel):
    profile: str = "default"
    dry_run: bool = False
    endpoint_url: str | None = None


class ApplyRequest(BaseModel):
    profile: str = "default"
    plan_path: str | None = None
    endpoint_url: str | None = None


class PolicyAttachRequest(BaseModel):
    name: str
    type: str  # "network" | "filesystem"
    spec: dict[str, Any]
