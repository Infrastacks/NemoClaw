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
    emitter.emit(INFERENCE_RESPONSE, {
      source: "inference",
      provider,
      model,
      endpoint,
      operation,
      latencyMs: Date.now() - start,
      success: true,
    });
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
