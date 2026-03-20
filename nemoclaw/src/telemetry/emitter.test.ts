// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { TelemetryEmitter, type TelemetrySink } from "./emitter.js";
import { SCHEMA_VERSION, SANDBOX_PLANNED, type TelemetryEvent } from "./types.js";

class MockSink implements TelemetrySink {
  events: TelemetryEvent[] = [];
  write(event: TelemetryEvent): void {
    this.events.push(event);
  }
}

describe("TelemetryEmitter", () => {
  it("emits event with correct structure", () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sandboxId: "sb-1", sinks: [sink] });

    emitter.emit(SANDBOX_PLANNED, { profile: "local" });

    expect(sink.events).toHaveLength(1);
    const event = sink.events[0]!;
    expect(event.schemaVersion).toBe(SCHEMA_VERSION);
    expect(event.eventType).toBe(SANDBOX_PLANNED);
    expect(event.sandboxId).toBe("sb-1");
    expect(event.timestamp).toBeTruthy();
    expect(event.data).toEqual({ profile: "local" });
  });

  it("fans out to multiple sinks", () => {
    const sinkA = new MockSink();
    const sinkB = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sinkA, sinkB] });

    emitter.emit(SANDBOX_PLANNED);

    expect(sinkA.events).toHaveLength(1);
    expect(sinkB.events).toHaveLength(1);
  });

  it("does not throw with zero sinks", () => {
    const emitter = new TelemetryEmitter();
    expect(() => emitter.emit(SANDBOX_PLANNED)).not.toThrow();
  });

  it("defaults sandboxId to empty string", () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sink] });

    emitter.emit(SANDBOX_PLANNED);

    expect(sink.events[0]!.sandboxId).toBe("");
  });
});
