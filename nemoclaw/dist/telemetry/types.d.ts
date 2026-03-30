export declare const SCHEMA_VERSION = "1.0";
export declare const SANDBOX_PROGRESS: "sandbox.progress";
export declare const SANDBOX_PLANNED: "sandbox.planned";
export declare const SANDBOX_CREATED: "sandbox.created";
export declare const SANDBOX_DESTROYED: "sandbox.destroyed";
export declare const SANDBOX_ERROR: "sandbox.error";
export declare const RUN_ID: "run.id";
export declare const INFERENCE_CONFIGURED: "inference.configured";
export declare const INFERENCE_REQUEST: "inference.request";
export declare const INFERENCE_RESPONSE: "inference.response";
export declare const INFERENCE_ERROR: "inference.error";
export declare const POLICY_APPLIED: "policy.applied";
export declare const POLICY_EVALUATED: "policy.evaluated";
export declare const POLICY_DENIED: "policy.denied";
export declare const NETWORK_APPROVED: "network.approved";
export declare const NETWORK_DENIED: "network.denied";
export declare const NETWORK_CONNECTED: "network.connected";
export declare const NETWORK_DISCONNECTED: "network.disconnected";
export declare const AGENT_HEARTBEAT: "agent.heartbeat";
export type TelemetryEventType = typeof SANDBOX_PROGRESS | typeof SANDBOX_PLANNED | typeof SANDBOX_CREATED | typeof SANDBOX_DESTROYED | typeof SANDBOX_ERROR | typeof RUN_ID | typeof INFERENCE_CONFIGURED | typeof INFERENCE_REQUEST | typeof INFERENCE_RESPONSE | typeof INFERENCE_ERROR | typeof POLICY_APPLIED | typeof POLICY_EVALUATED | typeof POLICY_DENIED | typeof NETWORK_APPROVED | typeof NETWORK_DENIED | typeof NETWORK_CONNECTED | typeof NETWORK_DISCONNECTED | typeof AGENT_HEARTBEAT;
export interface TelemetryEvent {
    schemaVersion: string;
    eventType: TelemetryEventType;
    sandboxId: string;
    timestamp: string;
    data: Record<string, unknown>;
}
//# sourceMappingURL=types.d.ts.map