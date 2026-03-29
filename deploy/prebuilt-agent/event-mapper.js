/**
 * Maps NemoClaw event types to Codicera TelemetryEventType.
 * Returns null for events that should not be forwarded.
 */
const TYPE_MAP = {
    // Lifecycle
    "sandbox.created": "sandbox.created",
    "sandbox.started": "sandbox.started",
    "sandbox.stopped": "sandbox.stopped",
    "sandbox.destroyed": "sandbox.removed",
    // Not forwarded as telemetry
    "sandbox.progress": null,
    "sandbox.planned": null,
    "run.id": null,
    "sandbox.error": null,
    // Inference (pass-through)
    "inference.request": "inference.request",
    "inference.response": "inference.response",
    "inference.error": "inference.error",
    // Policy (pass-through)
    "policy.applied": "policy.applied",
    "policy.violation": "policy.violation",
    "policy.evaluated": "policy.evaluated",
    "policy.denied": "policy.denied",
    "network.request": "network.request",
    "network.approved": "network.approved",
    "network.denied": "network.denied",
    // Behavior (pass-through)
    "file.read": "file.read",
    "file.write": "file.write",
    "code.generate": "code.generate",
    // ATIF trajectory events (CAR runtime)
    "trajectory.step": "trajectory.step",
    "trajectory.complete": "trajectory.complete",
    // PII governance (OpenShell L7 relay)
    "pii.detected": "pii.detected",
    "pii.detection": "pii.detected", // OpenShell relay emits "pii.detection" for audit events
    "pii.redacted": "pii.redacted",
    "pii.blocked": "pii.blocked",
    // Supply chain governance (openshell-sandbox L7 relay)
    "package.install": "package.install",
    "package.blocked": "package.blocked",
    "package.vulnerability": "package.vulnerability",
    "package.license_violation": "package.license_violation",
    // Task lifecycle (CAR runtime)
    "task.completed": "task.completed",
    "task.failed": "task.failed",
    "task.cancelled": "task.cancelled",
    // Internal NemoClaw events — drop
    "network.connected": null,
    "network.disconnected": null,
    "inference.configured": null,
};
/**
 * Map a NemoClaw event to a Codicera TelemetryEvent.
 * Returns null if the event type should not be forwarded.
 */
export function mapEvent(raw, sandboxId) {
    const eventType = raw.eventType ?? raw.type;
    if (!eventType)
        return null;
    const mapped = TYPE_MAP[eventType];
    if (mapped === undefined || mapped === null) {
        return null;
    }
    const { type: _type, eventType: _et, timestamp: _ts, sandbox_id: _sid, schemaVersion: _sv, sandboxId: _sid2, source, ...rest } = raw;
    return {
        schemaVersion: "1.1",
        eventType: mapped,
        sandboxId,
        timestamp: raw.timestamp ?? new Date().toISOString(),
        source: source ?? undefined,
        data: rest.data ? rest.data : rest,
    };
}
/** Check if a NemoClaw event is an error that should be logged but not sent as telemetry */
export function isErrorEvent(raw) {
    return (raw.eventType ?? raw.type) === "sandbox.error";
}
//# sourceMappingURL=event-mapper.js.map