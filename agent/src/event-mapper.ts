// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export const SCHEMA_VERSION = "1.1";

/** Known event types that the sidecar forwards to Codicera. */
const KNOWN_TYPES = new Set([
  // Sandbox lifecycle
  "sandbox.progress",
  "sandbox.planned",
  "sandbox.created",
  "sandbox.destroyed",
  "sandbox.error",
  "run.id",

  // Inference lifecycle
  "inference.configured",
  "inference.request",
  "inference.response",
  "inference.error",

  // Policy lifecycle
  "policy.applied",
  "policy.evaluated",
  "policy.denied",

  // Network lifecycle
  "network.approved",
  "network.denied",
  "network.connected",
  "network.disconnected",

  // Agent lifecycle
  "agent.heartbeat",

  // Behavior events
  "file.read",
  "file.write",
  "code.generate",
  "code.pr_created",
  "code.pr_merged",
]);

export interface RawEvent {
  eventType: string;
  sandboxId?: string;
  timestamp?: string;
  source?: string;
  data?: Record<string, unknown>;
}

export interface TelemetryEvent {
  schemaVersion: string;
  eventType: string;
  sandboxId: string;
  timestamp: string;
  source?: string;
  data: Record<string, unknown>;
}

export function mapEvent(raw: RawEvent): TelemetryEvent | null {
  if (!KNOWN_TYPES.has(raw.eventType)) return null;

  const event: TelemetryEvent = {
    schemaVersion: SCHEMA_VERSION,
    eventType: raw.eventType,
    sandboxId: raw.sandboxId ?? "",
    timestamp: raw.timestamp ?? new Date().toISOString(),
    data: raw.data ?? {},
  };

  if (raw.source) {
    event.source = raw.source;
  }

  return event;
}
