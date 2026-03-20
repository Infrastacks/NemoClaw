// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginLogger } from "../index.js";
import type { BlueprintRunOptions } from "./exec.js";

function mockFetchResponse(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    json: () => Promise.resolve(body),
  });
}

const logger: PluginLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const baseOpts: BlueprintRunOptions = {
  blueprintPath: "/tmp/bp",
  action: "plan",
  profile: "default",
};

describe("execBlueprintViaApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NEMOCLAW_API_URL = "http://127.0.0.1:18790";
  });

  afterEach(() => {
    delete process.env.NEMOCLAW_API_URL;
  });

  it("plan returns correct BlueprintRunResult shape", async () => {
    const planBody = {
      run_id: "nc-20260319-120000-aabbccdd",
      profile: "default",
      sandbox: { image: "openclaw:latest" },
      inference: { provider_type: "openai" },
      dry_run: false,
    };
    vi.stubGlobal("fetch", mockFetchResponse(200, planBody));

    const { execBlueprintViaApi } = await import("./exec.js");
    const result = await execBlueprintViaApi(baseOpts, logger);

    expect(result.success).toBe(true);
    expect(result.runId).toBe("nc-20260319-120000-aabbccdd");
    expect(result.action).toBe("plan");
    expect(result.exitCode).toBe(0);
  });

  it("returns failure when NEMOCLAW_API_URL is not set", async () => {
    delete process.env.NEMOCLAW_API_URL;

    const { execBlueprintViaApi } = await import("./exec.js");
    const result = await execBlueprintViaApi(baseOpts, logger);

    expect(result.success).toBe(false);
    expect(result.output).toContain("NEMOCLAW_API_URL not set");
  });

  it("maps 404 error to success:false with error message", async () => {
    const errorBody = {
      detail: { error: "Profile 'bad' not found", code: "PROFILE_NOT_FOUND" },
    };
    vi.stubGlobal("fetch", mockFetchResponse(404, errorBody));

    const { execBlueprintViaApi } = await import("./exec.js");
    const result = await execBlueprintViaApi(
      { ...baseOpts, profile: "bad" },
      logger,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("PROFILE_NOT_FOUND");
  });

  it("apply calls correct method and maps response", async () => {
    const applyBody = {
      run_id: "nc-20260319-120000-aabbccdd",
      sandbox_name: "openclaw",
      message: "ready",
    };
    vi.stubGlobal("fetch", mockFetchResponse(200, applyBody));

    const { execBlueprintViaApi } = await import("./exec.js");
    const result = await execBlueprintViaApi(
      { ...baseOpts, action: "apply" },
      logger,
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("apply");
    expect(result.runId).toBe("nc-20260319-120000-aabbccdd");
  });

  it("rollback requires runId", async () => {
    const { execBlueprintViaApi } = await import("./exec.js");
    const result = await execBlueprintViaApi(
      { ...baseOpts, action: "rollback" },
      logger,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("runId is required");
  });
});
