import type { PluginLogger } from "../index.js";
import type { TelemetryEvent } from "../telemetry/types.js";
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
    onTelemetry?: (event: TelemetryEvent) => void;
}
export interface BlueprintRunResult {
    success: boolean;
    runId: string;
    action: BlueprintAction;
    output: string;
    exitCode: number;
}
/**
 * Check for NEMOCLAW_API_URL env var. Returns the URL or null.
 * No auto-probing of default port to avoid latency on every invocation.
 */
export declare function tryApiBaseUrl(): string | null;
export declare function probeApiBaseUrl(baseUrl: string): Promise<boolean>;
export declare function resolveApiBaseUrl(): Promise<string | null>;
/**
 * Execute a blueprint action via the REST API instead of subprocess.
 * Dynamically imports BlueprintApiClient to avoid circular/eager loading.
 */
export declare function execBlueprintViaApi(options: BlueprintRunOptions, logger: PluginLogger, baseUrlOverride?: string): Promise<BlueprintRunResult>;
export declare function execBlueprint(options: BlueprintRunOptions, logger: PluginLogger): Promise<BlueprintRunResult>;
//# sourceMappingURL=exec.d.ts.map