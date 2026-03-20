// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parseTelemetryLine } from "./parse.js";

describe("parseTelemetryLine", () => {
  it("parses valid telemetry JSON", () => {
    const line = JSON.stringify({
      schemaVersion: "1.0",
      eventType: "sandbox.planned",
      sandboxId: "sb-1",
      timestamp: "2026-01-01T00:00:00Z",
      data: { profile: "local" },
    });

    const event = parseTelemetryLine(line);

    expect(event).not.toBeNull();
    expect(event!.eventType).toBe("sandbox.planned");
    expect(event!.sandboxId).toBe("sb-1");
    expect(event!.data).toEqual({ profile: "local" });
  });

  it("parses compact JSON (no spaces)", () => {
    const line = '{"schemaVersion":"1.0","eventType":"sandbox.progress","sandboxId":"","timestamp":"2026-01-01T00:00:00Z","data":{"pct":50,"label":"test"}}';

    const event = parseTelemetryLine(line);

    expect(event).not.toBeNull();
    expect(event!.eventType).toBe("sandbox.progress");
    expect(event!.data).toEqual({ pct: 50, label: "test" });
  });

  it("returns null for PROGRESS: lines", () => {
    expect(parseTelemetryLine("PROGRESS:50:Testing")).toBeNull();
  });

  it("returns null for RUN_ID: lines", () => {
    expect(parseTelemetryLine("RUN_ID:nc-123")).toBeNull();
  });

  it("returns null for JSON without schemaVersion", () => {
    const line = JSON.stringify({ eventType: "sandbox.planned", data: {} });
    expect(parseTelemetryLine(line)).toBeNull();
  });

  it("returns null for empty lines", () => {
    expect(parseTelemetryLine("")).toBeNull();
    expect(parseTelemetryLine("   ")).toBeNull();
  });

  it("returns null for plain log output", () => {
    expect(parseTelemetryLine("Sandbox 'openclaw' is ready.")).toBeNull();
  });
});
