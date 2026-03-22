// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TelemetryEmitter } from "./emitter.js";
import { INFERENCE_ERROR, INFERENCE_REQUEST, INFERENCE_RESPONSE } from "./types.js";

export interface InferenceTelemetryContext {
  provider: string;
  model: string;
  endpoint: string;
  operation: string;
}

/**
 * Wraps an async inference call with request/response/error telemetry events.
 * The API key never enters telemetry data — it stays in the closure of {@link fn}.
 *
 * NOTE: This wrapper only covers onboarding/validation inference calls made by
 * the NemoClaw CLI (e.g., credential validation, model availability checks).
 * Runtime inference during sandbox execution happens inside the OpenShell
 * subprocess and is NOT captured here — that telemetry is collected by the
 * Codicera agent sidecar running alongside the sandbox.
 */
export async function withInferenceTelemetry<T>(
  emitter: TelemetryEmitter,
  ctx: InferenceTelemetryContext,
  fn: () => Promise<T>,
): Promise<T> {
  const { provider, model, endpoint, operation } = ctx;
  emitter.emit(INFERENCE_REQUEST, { source: "inference", provider, model, endpoint, operation });
  const start = Date.now();
  try {
    const result = await fn();
    const responseData: Record<string, unknown> = {
      source: "inference",
      provider,
      model,
      endpoint,
      operation,
      latencyMs: Date.now() - start,
      success: true,
    };
    // Pass through token/cost metrics if the wrapped function returns them
    if (result != null && typeof result === "object") {
      const r = result as Record<string, unknown>;
      if (typeof r.input_tokens === "number") responseData.input_tokens = r.input_tokens;
      if (typeof r.output_tokens === "number") responseData.output_tokens = r.output_tokens;
      if (typeof r.cost_usd === "number") responseData.cost_usd = r.cost_usd;
    }
    emitter.emit(INFERENCE_RESPONSE, responseData);
    return result;
  } catch (err) {
    emitter.emit(INFERENCE_ERROR, {
      source: "inference",
      provider,
      model,
      endpoint,
      operation,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: (err as Record<string, unknown>)?.code,
    });
    throw err;
  }
}
