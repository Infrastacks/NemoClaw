"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.withInferenceTelemetry = withInferenceTelemetry;
const types_js_1 = require("./types.js");
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
async function withInferenceTelemetry(emitter, ctx, fn) {
    const { provider, model, endpoint, operation } = ctx;
    emitter.emit(types_js_1.INFERENCE_REQUEST, { source: "inference", provider, model, endpoint, operation });
    const start = Date.now();
    try {
        const result = await fn();
        const responseData = {
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
            const r = result;
            if (typeof r.input_tokens === "number")
                responseData.input_tokens = r.input_tokens;
            if (typeof r.output_tokens === "number")
                responseData.output_tokens = r.output_tokens;
            if (typeof r.cost_usd === "number")
                responseData.cost_usd = r.cost_usd;
        }
        emitter.emit(types_js_1.INFERENCE_RESPONSE, responseData);
        return result;
    }
    catch (err) {
        emitter.emit(types_js_1.INFERENCE_ERROR, {
            source: "inference",
            provider,
            model,
            endpoint,
            operation,
            errorMessage: err instanceof Error ? err.message : String(err),
            errorCode: err?.code,
        });
        throw err;
    }
}
//# sourceMappingURL=inference.js.map