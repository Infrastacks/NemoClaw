// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PluginLogger } from "../index.js";

export type BlueprintAction = "plan" | "apply" | "status" | "rollback";

export interface BlueprintRunOptions {
  blueprintPath: string;
  action: BlueprintAction;
  profile: string;
  planPath?: string;
  runId?: string;
  jsonOutput?: boolean;
  dryRun?: boolean;
  endpointUrl?: string;
}

export interface BlueprintRunResult {
  success: boolean;
  runId: string;
  action: BlueprintAction;
  output: string;
  exitCode: number;
}

function failResult(action: BlueprintAction, message: string): BlueprintRunResult {
  return { success: false, runId: "error", action, output: message, exitCode: 1 };
}

/**
 * Check for NEMOCLAW_API_URL env var. Returns the URL or null.
 * No auto-probing of default port to avoid latency on every invocation.
 */
export function tryApiBaseUrl(): string | null {
  return process.env.NEMOCLAW_API_URL ?? null;
}

/**
 * Execute a blueprint action via the REST API instead of subprocess.
 * Dynamically imports BlueprintApiClient to avoid circular/eager loading.
 */
export async function execBlueprintViaApi(
  options: BlueprintRunOptions,
  logger: PluginLogger,
): Promise<BlueprintRunResult> {
  const baseUrl = tryApiBaseUrl();
  if (!baseUrl) {
    return failResult(options.action, "NEMOCLAW_API_URL not set");
  }

  try {
    const { BlueprintApiClient } = await import("../api/client.js");
    const client = new BlueprintApiClient(baseUrl);

    switch (options.action) {
      case "plan": {
        const result = await client.plan({
          profile: options.profile,
          dry_run: options.dryRun,
          endpoint_url: options.endpointUrl,
        });
        return {
          success: true,
          runId: result.run_id,
          action: "plan",
          output: JSON.stringify(result),
          exitCode: 0,
        };
      }
      case "apply": {
        const result = await client.apply({
          profile: options.profile,
          plan_path: options.planPath,
          endpoint_url: options.endpointUrl,
        });
        return {
          success: true,
          runId: result.run_id,
          action: "apply",
          output: JSON.stringify(result),
          exitCode: 0,
        };
      }
      case "rollback": {
        if (!options.runId) {
          return failResult("rollback", "runId is required for rollback");
        }
        const result = await client.rollback(options.runId);
        return {
          success: true,
          runId: result.run_id,
          action: "rollback",
          output: JSON.stringify(result),
          exitCode: 0,
        };
      }
      case "status": {
        const result = options.runId
          ? await client.getRun(options.runId)
          : (await client.listRuns())[0];
        return {
          success: true,
          runId: result?.run_id ?? "unknown",
          action: "status",
          output: JSON.stringify(result ?? {}),
          exitCode: 0,
        };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failResult(options.action, message);
  }
}

export async function execBlueprint(
  options: BlueprintRunOptions,
  logger: PluginLogger,
): Promise<BlueprintRunResult> {
  // When NEMOCLAW_API_URL is set, try API path first
  if (tryApiBaseUrl()) {
    logger.info(`Using API at ${tryApiBaseUrl()} for blueprint ${options.action}`);
    const apiResult = await execBlueprintViaApi(options, logger);
    if (apiResult.success) {
      return apiResult;
    }
    logger.warn(`API execution failed (${apiResult.output}), falling back to subprocess`);
  }

  const runnerPath = join(options.blueprintPath, "orchestrator", "runner.py");

  if (!existsSync(runnerPath)) {
    const msg = `Blueprint runner not found at ${runnerPath}. Is the blueprint installed correctly?`;
    logger.error(msg);
    return failResult(options.action, msg);
  }

  const args: string[] = [runnerPath, options.action, "--profile", options.profile];

  if (options.jsonOutput) args.push("--json");
  if (options.planPath) args.push("--plan", options.planPath);
  if (options.runId) args.push("--run-id", options.runId);
  if (options.dryRun) args.push("--dry-run");
  if (options.endpointUrl) args.push("--endpoint-url", options.endpointUrl);

  logger.info(`Running blueprint: ${options.action} (profile: ${options.profile})`);

  return new Promise((resolve) => {
    const chunks: string[] = [];
    const proc = spawn("python3", args, {
      cwd: options.blueprintPath,
      env: {
        ...process.env,
        NEMOCLAW_BLUEPRINT_PATH: options.blueprintPath,
        NEMOCLAW_ACTION: options.action,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data: Buffer) => {
      const line = data.toString();
      chunks.push(line);
    });

    proc.stderr.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) logger.warn(line);
    });

    proc.on("close", (code) => {
      const output = chunks.join("");
      const runIdMatch = output.match(/^RUN_ID:(.+)$/m);
      resolve({
        success: code === 0,
        runId: runIdMatch?.[1] ?? "unknown",
        action: options.action,
        output,
        exitCode: code ?? 1,
      });
    });

    proc.on("error", (err) => {
      const msg = err.message.includes("ENOENT")
        ? "python3 not found. The blueprint runner requires Python 3.11+."
        : `Failed to start blueprint runner: ${err.message}`;
      logger.error(msg);
      resolve(failResult(options.action, msg));
    });
  });
}
