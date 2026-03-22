// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { TelemetryEmitter, type TelemetrySink } from "./emitter.js";
import {
  NETWORK_APPROVED,
  NETWORK_DENIED,
  POLICY_DENIED,
  POLICY_EVALUATED,
  type TelemetryEvent,
} from "./types.js";
import { emitProxyLineEvents, parseProxyLogLine } from "./proxy-parser.js";

class MockSink implements TelemetrySink {
  events: TelemetryEvent[] = [];
  write(event: TelemetryEvent): void {
    this.events.push(event);
  }
}

describe("parseProxyLogLine", () => {
  it("parses an allow decision", () => {
    const line = "[2026-03-22T10:30:00Z] POLICY decision=allow policy=nim_service dest=nim-service.local:443 method=GET path=/v1/models";
    const result = parseProxyLogLine(line);
    expect(result).toEqual({
      timestamp: "2026-03-22T10:30:00Z",
      decision: "allow",
      policy: "nim_service",
      dest: "nim-service.local:443",
      method: "GET",
      path: "/v1/models",
    });
  });

  it("parses a deny decision", () => {
    const line = "[2026-03-22T10:31:00Z] POLICY decision=deny policy=egress_block dest=evil.com:80 method=POST path=/exfil";
    const result = parseProxyLogLine(line);
    expect(result).toEqual({
      timestamp: "2026-03-22T10:31:00Z",
      decision: "deny",
      policy: "egress_block",
      dest: "evil.com:80",
      method: "POST",
      path: "/exfil",
    });
  });

  it("returns null for non-policy lines", () => {
    expect(parseProxyLogLine("[2026-03-22T10:30:00Z] INFO started")).toBeNull();
    expect(parseProxyLogLine("")).toBeNull();
    expect(parseProxyLogLine("just some text")).toBeNull();
  });

  it("returns null for invalid decision values", () => {
    const line = "[2026-03-22T10:30:00Z] POLICY decision=maybe policy=test dest=x:80 method=GET path=/";
    expect(parseProxyLogLine(line)).toBeNull();
  });

  it("handles missing optional kv fields gracefully", () => {
    const line = "[2026-03-22T10:30:00Z] POLICY decision=allow";
    const result = parseProxyLogLine(line);
    expect(result).toEqual({
      timestamp: "2026-03-22T10:30:00Z",
      decision: "allow",
      policy: "",
      dest: "",
      method: "",
      path: "",
    });
  });

  it("trims whitespace from input", () => {
    const line = "  [2026-03-22T10:30:00Z] POLICY decision=deny policy=test dest=a:1 method=GET path=/  \n";
    const result = parseProxyLogLine(line);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
  });
});

describe("emitProxyLineEvents", () => {
  it("emits policy.evaluated and network.approved on allow", () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sink] });

    const result = emitProxyLineEvents(
      emitter,
      "[2026-03-22T10:30:00Z] POLICY decision=allow policy=nim dest=nim.local:443 method=GET path=/v1/models",
    );

    expect(result).not.toBeNull();
    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]!.eventType).toBe(POLICY_EVALUATED);
    expect(sink.events[0]!.data.source).toBe("openshell");
    expect(sink.events[0]!.data.policy).toBe("nim");
    expect(sink.events[0]!.data.rule_id).toBe("nim");
    expect(sink.events[1]!.eventType).toBe(NETWORK_APPROVED);
    expect(sink.events[1]!.data.source).toBe("openshell");
  });

  it("emits policy.denied and network.denied on deny with reason", () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sink] });

    const result = emitProxyLineEvents(
      emitter,
      "[2026-03-22T10:31:00Z] POLICY decision=deny policy=egress dest=evil.com:80 method=POST path=/exfil",
    );

    expect(result).not.toBeNull();
    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]!.eventType).toBe(POLICY_DENIED);
    expect(sink.events[0]!.data.reason).toBe("Policy denied by egress");
    expect(sink.events[0]!.data.rule_id).toBe("egress");
    expect(sink.events[1]!.eventType).toBe(NETWORK_DENIED);
    expect(sink.events[1]!.data.reason).toBe("Policy denied by egress");
  });

  it("returns null and emits nothing for non-policy lines", () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sink] });

    const result = emitProxyLineEvents(emitter, "[2026-03-22T10:30:00Z] INFO started");

    expect(result).toBeNull();
    expect(sink.events).toHaveLength(0);
  });
});
