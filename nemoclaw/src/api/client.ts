// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * HTTP client for the NemoClaw Blueprint REST API.
 *
 * Uses native fetch (Node 20+). Zero additional npm dependencies.
 */

import type {
  ApiError,
  ApplyRequest,
  ApplyResponse,
  BlueprintDescribeResponse,
  BlueprintSummary,
  HealthResponse,
  PlanRequest,
  PlanResponse,
  RollbackResponse,
  RunStatusResponse,
} from "./types.js";

export class BlueprintApiError extends Error {
  readonly statusCode: number;
  readonly apiError: ApiError;

  constructor(statusCode: number, apiError: ApiError) {
    super(`${apiError.code}: ${apiError.error}`);
    this.name = "BlueprintApiError";
    this.statusCode = statusCode;
    this.apiError = apiError;
  }
}

export class BlueprintApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = "http://127.0.0.1:18790") {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const resp = await fetch(url, init);

    if (!resp.ok) {
      let apiError: ApiError;
      try {
        const json = (await resp.json()) as Record<string, unknown>;
        // FastAPI wraps HTTPException detail in a "detail" envelope
        apiError = (json.detail ?? json) as ApiError;
      } catch {
        apiError = { error: resp.statusText, code: "UNKNOWN" };
      }
      throw new BlueprintApiError(resp.status, apiError);
    }

    return (await resp.json()) as T;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health");
  }

  async plan(req: PlanRequest = {}): Promise<PlanResponse> {
    return this.request<PlanResponse>("POST", "/v1/blueprints/plan", req);
  }

  async apply(req: ApplyRequest = {}): Promise<ApplyResponse> {
    return this.request<ApplyResponse>("POST", "/v1/blueprints/apply", req);
  }

  async listRuns(): Promise<RunStatusResponse[]> {
    return this.request<RunStatusResponse[]>("GET", "/v1/runs");
  }

  async getRun(runId: string): Promise<RunStatusResponse> {
    return this.request<RunStatusResponse>("GET", `/v1/runs/${encodeURIComponent(runId)}`);
  }

  async rollback(runId: string): Promise<RollbackResponse> {
    return this.request<RollbackResponse>(
      "POST",
      `/v1/runs/${encodeURIComponent(runId)}/rollback`,
    );
  }

  async listBlueprints(): Promise<BlueprintSummary[]> {
    return this.request<BlueprintSummary[]>("GET", "/v1/blueprints");
  }

  async describeBlueprint(): Promise<BlueprintDescribeResponse> {
    return this.request<BlueprintDescribeResponse>("GET", "/v1/blueprints/current");
  }
}
