// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { mapEvent, SCHEMA_VERSION, type RawEvent } from "./event-mapper.js";

describe("mapEvent", () => {
  it("returns schema version 1.1", () => {
    expect(SCHEMA_VERSION).toBe("1.1");

    const result = mapEvent({ eventType: "sandbox.created" });
    expect(result?.schemaVersion).toBe("1.1");
  });

  it("maps existing sandbox event types", () => {
    const result = mapEvent({ eventType: "sandbox.created", sandboxId: "sb-1" });
    expect(result).not.toBeNull();
    expect(result!.eventType).toBe("sandbox.created");
    expect(result!.sandboxId).toBe("sb-1");
  });

  it("maps behavior event types", () => {
    const behaviorTypes = [
      "file.read",
      "file.write",
      "code.generate",
      "code.pr_created",
      "code.pr_merged",
    ];

    for (const type of behaviorTypes) {
      const result = mapEvent({ eventType: type });
      expect(result, `${type} should map`).not.toBeNull();
      expect(result!.eventType).toBe(type);
    }
  });

  it("maps policy event types", () => {
    const policyTypes = ["policy.evaluated", "policy.denied"];
    for (const type of policyTypes) {
      const result = mapEvent({ eventType: type });
      expect(result, `${type} should map`).not.toBeNull();
      expect(result!.eventType).toBe(type);
    }
  });

  it("maps network event types", () => {
    const networkTypes = ["network.approved", "network.denied"];
    for (const type of networkTypes) {
      const result = mapEvent({ eventType: type });
      expect(result, `${type} should map`).not.toBeNull();
      expect(result!.eventType).toBe(type);
    }
  });

  it("returns null for unknown event types", () => {
    const result = mapEvent({ eventType: "unknown.event" });
    expect(result).toBeNull();
  });

  it("promotes source field to top-level", () => {
    const raw: RawEvent = {
      eventType: "file.read",
      source: "vscode-extension",
      data: { path: "/src/main.ts" },
    };

    const result = mapEvent(raw);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("vscode-extension");
  });

  it("omits source field when not present in raw event", () => {
    const result = mapEvent({ eventType: "file.read" });
    expect(result).not.toBeNull();
    expect(result!.source).toBeUndefined();
  });

  it("defaults sandboxId to empty string", () => {
    const result = mapEvent({ eventType: "sandbox.created" });
    expect(result!.sandboxId).toBe("");
  });

  it("defaults data to empty object", () => {
    const result = mapEvent({ eventType: "sandbox.created" });
    expect(result!.data).toEqual({});
  });

  it("preserves timestamp from raw event", () => {
    const ts = "2026-03-22T10:00:00.000Z";
    const result = mapEvent({ eventType: "file.write", timestamp: ts });
    expect(result!.timestamp).toBe(ts);
  });

  it("generates timestamp if raw event has none", () => {
    const before = new Date().toISOString();
    const result = mapEvent({ eventType: "file.write" });
    const after = new Date().toISOString();
    expect(result!.timestamp >= before).toBe(true);
    expect(result!.timestamp <= after).toBe(true);
  });

  it("preserves data from raw event", () => {
    const data = { path: "/src/main.ts", lines: 42 };
    const result = mapEvent({ eventType: "file.read", data });
    expect(result!.data).toEqual(data);
  });
});
