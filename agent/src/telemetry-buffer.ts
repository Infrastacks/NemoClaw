// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TelemetryEvent } from "./event-mapper.js";

export interface TelemetryTransport {
  send(events: TelemetryEvent[]): Promise<void>;
}

/**
 * Batches telemetry events and flushes them via a transport.
 * Flushes when the batch is full or after a time interval, whichever comes first.
 */
export class TelemetryBuffer {
  private readonly transport: TelemetryTransport;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private batch: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(transport: TelemetryTransport, opts?: { batchSize?: number; flushIntervalMs?: number }) {
    this.transport = transport;
    this.batchSize = opts?.batchSize ?? 50;
    this.flushIntervalMs = opts?.flushIntervalMs ?? 5_000;
  }

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
  }

  push(event: TelemetryEvent): void {
    this.batch.push(event);
    if (this.batch.length >= this.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;
    const events = this.batch;
    this.batch = [];
    await this.transport.send(events);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
