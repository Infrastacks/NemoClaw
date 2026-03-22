// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Proxy log line parser for policy decision telemetry.
 *
 * Expected log format:
 * [2026-03-22T10:30:00Z] POLICY decision=allow policy=nim_service dest=nim-service.local:443 method=GET path=/v1/models
 */

import type { TelemetryEmitter } from "./emitter.js";
import {
  NETWORK_APPROVED,
  NETWORK_DENIED,
  POLICY_DENIED,
  POLICY_EVALUATED,
} from "./types.js";

export interface PolicyDecision {
  decision: "allow" | "deny";
  policy: string;
  dest: string;
  method: string;
  path: string;
  timestamp: string;
}

const DECISION_RE = /^\[(?<ts>[^\]]+)\]\s+POLICY\s+(?<kvs>.+)$/;
const KV_RE = /(\w+)=(\S+)/g;

export function parseProxyLogLine(line: string): PolicyDecision | null {
  const trimmed = line.trim();
  const m = DECISION_RE.exec(trimmed);
  if (!m?.groups) return null;

  const kvs: Record<string, string> = {};
  for (const [, key, value] of m.groups.kvs.matchAll(KV_RE)) {
    kvs[key] = value;
  }

  const decision = kvs.decision;
  if (decision !== "allow" && decision !== "deny") return null;

  return {
    timestamp: m.groups.ts,
    decision,
    policy: kvs.policy ?? "",
    dest: kvs.dest ?? "",
    method: kvs.method ?? "",
    path: kvs.path ?? "",
  };
}

/**
 * Parse a proxy log line and emit the corresponding policy + network telemetry events.
 * Returns the parsed decision (or null if the line was not a policy line).
 */
export function emitProxyLineEvents(
  emitter: TelemetryEmitter,
  line: string,
): PolicyDecision | null {
  const parsed = parseProxyLogLine(line);
  if (!parsed) return null;

  const data: Record<string, unknown> = {
    source: "openshell",
    policy: parsed.policy,
    rule_id: parsed.policy,
    dest: parsed.dest,
    method: parsed.method,
    path: parsed.path,
    timestamp: parsed.timestamp,
  };

  if (parsed.decision === "allow") {
    emitter.emit(POLICY_EVALUATED, data);
    emitter.emit(NETWORK_APPROVED, data);
  } else {
    const denyData = { ...data, reason: `Policy denied by ${parsed.policy}` };
    emitter.emit(POLICY_DENIED, denyData);
    emitter.emit(NETWORK_DENIED, denyData);
  }

  return parsed;
}
