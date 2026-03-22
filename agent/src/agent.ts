// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { homedir } from "node:os";
import { join } from "node:path";
import { mapEvent, type RawEvent } from "./event-mapper.js";
import { EventTailer } from "./tail.js";
import { TelemetryBuffer } from "./telemetry-buffer.js";
import { WsTransport } from "./ws-transport.js";

export interface AgentOptions {
  wsUrl: string;
  eventsLogPath?: string;
  behaviorLogPath?: string;
  batchSize?: number;
  flushIntervalMs?: number;
}

export class Agent {
  private readonly transport: WsTransport;
  private readonly buffer: TelemetryBuffer;
  private readonly eventsTailer: EventTailer;
  private readonly behaviorTailer: EventTailer | null;

  constructor(opts: AgentOptions) {
    const eventsPath = opts.eventsLogPath ?? join(homedir(), ".nemoclaw", "events.jsonl");

    this.transport = new WsTransport(opts.wsUrl);
    this.buffer = new TelemetryBuffer(this.transport, {
      batchSize: opts.batchSize,
      flushIntervalMs: opts.flushIntervalMs,
    });

    const handler = (raw: RawEvent) => {
      const event = mapEvent(raw);
      if (event) this.buffer.push(event);
    };

    this.eventsTailer = new EventTailer(eventsPath, handler);

    if (opts.behaviorLogPath) {
      this.behaviorTailer = new EventTailer(opts.behaviorLogPath, handler);
    } else {
      this.behaviorTailer = null;
    }
  }

  async start(): Promise<void> {
    this.buffer.start();
    await this.eventsTailer.start();
    if (this.behaviorTailer) {
      await this.behaviorTailer.start();
    }
  }

  async stop(): Promise<void> {
    await this.eventsTailer.stop();
    if (this.behaviorTailer) {
      await this.behaviorTailer.stop();
    }
    await this.buffer.stop();
    this.transport.close();
  }
}
