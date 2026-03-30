import type { TelemetryEvent } from "./types.js";
/**
 * Try to parse a single line as a structured telemetry event.
 * Returns null for non-telemetry lines (legacy PROGRESS:, RUN_ID:, log output, partial JSON).
 */
export declare function parseTelemetryLine(line: string): TelemetryEvent | null;
//# sourceMappingURL=parse.d.ts.map