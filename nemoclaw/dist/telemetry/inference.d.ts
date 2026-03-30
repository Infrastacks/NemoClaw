import type { TelemetryEmitter } from "./emitter.js";
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
export declare function withInferenceTelemetry<T>(emitter: TelemetryEmitter, ctx: InferenceTelemetryContext, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=inference.d.ts.map