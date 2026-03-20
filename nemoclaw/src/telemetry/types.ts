// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export const SCHEMA_VERSION = "1.0";

// Emitted today
export const SANDBOX_PROGRESS = "sandbox.progress" as const;
export const SANDBOX_PLANNED = "sandbox.planned" as const;
export const SANDBOX_CREATED = "sandbox.created" as const;
export const SANDBOX_DESTROYED = "sandbox.destroyed" as const;
export const SANDBOX_ERROR = "sandbox.error" as const;
export const RUN_ID = "run.id" as const;

// Forward-compat — defined but not emitted yet
export const INFERENCE_REQUEST = "inference.request" as const;
export const INFERENCE_RESPONSE = "inference.response" as const;
export const POLICY_EVALUATED = "policy.evaluated" as const;
export const POLICY_DENIED = "policy.denied" as const;
export const NETWORK_CONNECTED = "network.connected" as const;
export const NETWORK_DISCONNECTED = "network.disconnected" as const;
export const AGENT_HEARTBEAT = "agent.heartbeat" as const;

export type TelemetryEventType =
  | typeof SANDBOX_PROGRESS
  | typeof SANDBOX_PLANNED
  | typeof SANDBOX_CREATED
  | typeof SANDBOX_DESTROYED
  | typeof SANDBOX_ERROR
  | typeof RUN_ID
  | typeof INFERENCE_REQUEST
  | typeof INFERENCE_RESPONSE
  | typeof POLICY_EVALUATED
  | typeof POLICY_DENIED
  | typeof NETWORK_CONNECTED
  | typeof NETWORK_DISCONNECTED
  | typeof AGENT_HEARTBEAT;

export interface TelemetryEvent {
  schemaVersion: string;
  eventType: TelemetryEventType;
  sandboxId: string;
  timestamp: string;
  data: Record<string, unknown>;
}
