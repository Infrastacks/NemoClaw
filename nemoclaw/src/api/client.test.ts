// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BlueprintApiClient, BlueprintApiError } from "./client.js";

function mockFetchResponse(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  });
}

describe("BlueprintApiClient", () => {
  let client: BlueprintApiClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new BlueprintApiClient("http://127.0.0.1:18790");
  });

  it("health() calls GET /health and returns parsed response", async () => {
    const body = { status: "ok", version: "0.1.0" };
    vi.stubGlobal("fetch", mockFetchResponse(200, body));

    const result = await client.health();

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:18790/health", expect.objectContaining({ method: "GET" }));
    expect(result).toEqual(body);
  });

  it("plan() sends JSON body and returns PlanResponse", async () => {
    const body = {
      run_id: "nc-20260101-120000-aabbccdd",
      profile: "local",
      sandbox: { image: "openclaw:latest" },
      inference: { provider_type: "openai" },
      dry_run: false,
    };
    vi.stubGlobal("fetch", mockFetchResponse(200, body));

    const result = await client.plan({ profile: "local" });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18790/v1/blueprints/plan",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ profile: "local" }),
      }),
    );
    expect(result.run_id).toBe("nc-20260101-120000-aabbccdd");
    expect(result.profile).toBe("local");
  });

  it("plan() on 404 throws BlueprintApiError with statusCode and apiError", async () => {
    const errorBody = {
      detail: { error: "Profile 'bad' not found", code: "PROFILE_NOT_FOUND" },
    };
    vi.stubGlobal("fetch", mockFetchResponse(404, errorBody));

    await expect(client.plan({ profile: "bad" })).rejects.toThrow(BlueprintApiError);

    try {
      await client.plan({ profile: "bad" });
    } catch (err) {
      const e = err as BlueprintApiError;
      expect(e.statusCode).toBe(404);
      expect(e.apiError.code).toBe("PROFILE_NOT_FOUND");
    }
  });

  it("apply() sends correct request", async () => {
    const body = { run_id: "nc-test", sandbox_name: "openclaw", message: "ready" };
    vi.stubGlobal("fetch", mockFetchResponse(200, body));

    const result = await client.apply({ profile: "local" });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18790/v1/blueprints/apply",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.sandbox_name).toBe("openclaw");
  });

  it("rollback() POSTs to /v1/runs/{id}/rollback", async () => {
    const body = { run_id: "nc-test", message: "rolled back" };
    vi.stubGlobal("fetch", mockFetchResponse(200, body));

    const result = await client.rollback("nc-test");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18790/v1/runs/nc-test/rollback",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.message).toBe("rolled back");
  });

  it("listRuns() GETs /v1/runs", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(200, []));

    const result = await client.listRuns();

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18790/v1/runs",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual([]);
  });

  it("listBlueprints() GETs /v1/blueprints", async () => {
    const body = [{ version: "0.1.0", description: "Test", profiles: ["default"] }];
    vi.stubGlobal("fetch", mockFetchResponse(200, body));

    const result = await client.listBlueprints();

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18790/v1/blueprints",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual(body);
    expect(result[0].profiles).toEqual(["default"]);
  });

  it("describeBlueprint() GETs /v1/blueprints/current", async () => {
    const body = {
      version: "0.1.0",
      description: "Test",
      profiles: ["default"],
      sandbox: { image: "openclaw:latest", name: "openclaw" },
      min_openshell: "0.1.0",
      min_openclaw: "2026.3.0",
    };
    vi.stubGlobal("fetch", mockFetchResponse(200, body));

    const result = await client.describeBlueprint();

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18790/v1/blueprints/current",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.version).toBe("0.1.0");
    expect(result.min_openshell).toBe("0.1.0");
  });

  it("getBlueprint() GETs /v1/blueprints/{version}", async () => {
    const body = {
      version: "0.1.0",
      description: "Test",
      profiles: ["default"],
      sandbox: { image: "openclaw:latest", name: "openclaw" },
      min_openshell: "0.1.0",
      min_openclaw: "2026.3.0",
    };
    vi.stubGlobal("fetch", mockFetchResponse(200, body));

    const result = await client.getBlueprint("0.1.0");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:18790/v1/blueprints/0.1.0",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.version).toBe("0.1.0");
  });
});
