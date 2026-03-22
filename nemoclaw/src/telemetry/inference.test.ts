// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { TelemetryEmitter, type TelemetrySink } from "./emitter.js";
import { INFERENCE_ERROR, INFERENCE_REQUEST, INFERENCE_RESPONSE, type TelemetryEvent } from "./types.js";
import { withInferenceTelemetry } from "./inference.js";

class MockSink implements TelemetrySink {
  events: TelemetryEvent[] = [];
  write(event: TelemetryEvent): void {
    this.events.push(event);
  }
}

describe("withInferenceTelemetry", () => {
  const ctx = { provider: "nvidia-nim", model: "llama-3.1-8b", endpoint: "https://api.example.com/v1", operation: "validateCredentials" };

  it("emits request and response on success", async () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sink] });

    const result = await withInferenceTelemetry(emitter, ctx, async () => "ok");

    expect(result).toBe("ok");
    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]!.eventType).toBe(INFERENCE_REQUEST);
    expect(sink.events[0]!.data.source).toBe("inference");
    expect(sink.events[0]!.data.provider).toBe("nvidia-nim");
    expect(sink.events[0]!.data.operation).toBe("validateCredentials");
    expect(sink.events[1]!.eventType).toBe(INFERENCE_RESPONSE);
    expect(sink.events[1]!.data.success).toBe(true);
    expect(sink.events[1]!.data.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("emits request and error on failure, then rethrows", async () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sink] });

    await expect(
      withInferenceTelemetry(emitter, ctx, async () => {
        throw new Error("connection refused");
      }),
    ).rejects.toThrow("connection refused");

    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]!.eventType).toBe(INFERENCE_REQUEST);
    expect(sink.events[1]!.eventType).toBe(INFERENCE_ERROR);
    expect(sink.events[1]!.data.errorMessage).toBe("connection refused");
  });

  it("includes error_code when present on the error object", async () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sink] });
    const codedError = Object.assign(new Error("fail"), { code: "ECONNREFUSED" });

    await expect(
      withInferenceTelemetry(emitter, ctx, async () => {
        throw codedError;
      }),
    ).rejects.toThrow("fail");

    expect(sink.events[1]!.data.errorCode).toBe("ECONNREFUSED");
  });

  it("includes token counts and cost when returned by the wrapped function", async () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sink] });

    const result = await withInferenceTelemetry(emitter, ctx, async () => ({
      answer: "hello",
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.003,
    }));

    expect(result.answer).toBe("hello");
    const responseEvent = sink.events[1]!;
    expect(responseEvent.eventType).toBe(INFERENCE_RESPONSE);
    expect(responseEvent.data.input_tokens).toBe(100);
    expect(responseEvent.data.output_tokens).toBe(50);
    expect(responseEvent.data.cost_usd).toBe(0.003);
  });

  it("omits token fields when result does not contain them", async () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sink] });

    await withInferenceTelemetry(emitter, ctx, async () => "plain string");

    const responseEvent = sink.events[1]!;
    expect(responseEvent.data.input_tokens).toBeUndefined();
    expect(responseEvent.data.output_tokens).toBeUndefined();
    expect(responseEvent.data.cost_usd).toBeUndefined();
  });

  it("never leaks API key into telemetry data", async () => {
    const sink = new MockSink();
    const emitter = new TelemetryEmitter({ sinks: [sink] });
    const secretKey = "nvapi-super-secret-key-12345";

    await withInferenceTelemetry(emitter, ctx, async () => {
      // The key is used inside the closure but never passed to telemetry
      return `auth with ${secretKey}`;
    });

    const allData = JSON.stringify(sink.events);
    expect(allData).not.toContain(secretKey);
  });
});
