// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginLogger } from "../index.js";
import type { BlueprintRunOptions } from "./exec.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

function mockFetchResponse(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    json: () => Promise.resolve(body),
  });
}

const { spawn } = await import("node:child_process");

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

function mockSpawnRun(
  stdoutChunks: string[],
  exitCode = 0,
): void {
  vi.mocked(spawn).mockImplementation(() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();

    queueMicrotask(() => {
      for (const chunk of stdoutChunks) {
        proc.stdout.emit("data", Buffer.from(chunk));
      }
      proc.emit("close", exitCode);
    });

    return proc as ReturnType<typeof spawn>;
  });
}

describe("exec.ts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  it("status via API uses getRun when runId is provided", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse(200, { run_id: "nc-1", profile: "default", sandbox_name: "openclaw" }),
    );

    const { execBlueprintViaApi } = await import("./exec.js");
    const result = await execBlueprintViaApi(
      { ...baseOpts, action: "status", runId: "nc-1" },
      logger,
    );

    expect(result.success).toBe(true);
    expect(result.runId).toBe("nc-1");
  });

  it("execBlueprint prefers the default localhost API when healthy", async () => {
    delete process.env.NEMOCLAW_API_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "http://127.0.0.1:18790/health") {
          return { ok: true, status: 200, statusText: "OK", json: async () => ({ status: "ok" }) };
        }
        if (url === "http://127.0.0.1:18790/v1/blueprints/plan") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({
              run_id: "nc-default-api",
              profile: "default",
              sandbox: { image: "openclaw:latest" },
              inference: { provider_type: "openai" },
              dry_run: false,
            }),
          };
        }
        throw new Error(`unexpected fetch url: ${url}`);
      }),
    );

    const { execBlueprint } = await import("./exec.js");
    const result = await execBlueprint(baseOpts, logger);

    expect(result.success).toBe(true);
    expect(result.runId).toBe("nc-default-api");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("execBlueprint falls back to subprocess when API probe fails", async () => {
    delete process.env.NEMOCLAW_API_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
      }),
    );
    mockSpawnRun(["RUN_ID:nc-subprocess\n", "Sandbox ready\n"]);

    const { execBlueprint } = await import("./exec.js");
    const result = await execBlueprint(baseOpts, logger);

    expect(result.success).toBe(true);
    expect(result.runId).toBe("nc-subprocess");
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("execBlueprint uses explicit NEMOCLAW_API_URL override when healthy", async () => {
    process.env.NEMOCLAW_API_URL = "http://custom-api:19999";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "http://custom-api:19999/health") {
          return { ok: true, status: 200, statusText: "OK", json: async () => ({ status: "ok" }) };
        }
        if (url === "http://custom-api:19999/v1/blueprints/apply") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({
              run_id: "nc-custom-api",
              sandbox_name: "openclaw",
              message: "ready",
            }),
          };
        }
        throw new Error(`unexpected fetch url: ${url}`);
      }),
    );

    const { execBlueprint } = await import("./exec.js");
    const result = await execBlueprint({ ...baseOpts, action: "apply" }, logger);

    expect(result.success).toBe(true);
    expect(result.runId).toBe("nc-custom-api");
    expect(spawn).not.toHaveBeenCalled();
  });
});
