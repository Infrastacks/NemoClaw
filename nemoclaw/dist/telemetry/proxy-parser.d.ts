/**
 * Proxy log line parser for policy decision telemetry.
 *
 * Expected log format:
 * [2026-03-22T10:30:00Z] POLICY decision=allow policy=nim_service dest=nim-service.local:443 method=GET path=/v1/models
 */
import type { TelemetryEmitter } from "./emitter.js";
export interface PolicyDecision {
    decision: "allow" | "deny";
    policy: string;
    dest: string;
    method: string;
    path: string;
    timestamp: string;
}
export declare function parseProxyLogLine(line: string): PolicyDecision | null;
/**
 * Parse a proxy log line and emit the corresponding policy + network telemetry events.
 * Returns the parsed decision (or null if the line was not a policy line).
 */
export declare function emitProxyLineEvents(emitter: TelemetryEmitter, line: string): PolicyDecision | null;
//# sourceMappingURL=proxy-parser.d.ts.map