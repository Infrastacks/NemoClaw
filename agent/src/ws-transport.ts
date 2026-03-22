// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { WebSocket } from "ws";
import type { TelemetryTransport } from "./telemetry-buffer.js";
import type { TelemetryEvent } from "./event-mapper.js";

/**
 * Sends batched telemetry events over a persistent WebSocket connection.
 * Reconnects automatically on close.
 */
export class WsTransport implements TelemetryTransport {
  private readonly url: string;
  private ws: WebSocket | null = null;
  private connecting = false;

  constructor(url: string) {
    this.url = url;
  }

  async send(events: TelemetryEvent[]): Promise<void> {
    try {
      const ws = await this.connect();
      ws.send(JSON.stringify(events));
    } catch {
      // Connection failed — events are dropped; next flush will retry
    }
  }

  close(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }

    if (this.connecting && this.ws) {
      return new Promise((resolve) => {
        this.ws!.once("open", () => resolve(this.ws!));
      });
    }

    this.connecting = true;
    this.ws = new WebSocket(this.url);

    return new Promise((resolve, reject) => {
      this.ws!.once("open", () => {
        this.connecting = false;
        resolve(this.ws!);
      });

      this.ws!.once("close", () => {
        this.connecting = false;
        this.ws = null;
      });

      this.ws!.once("error", (err) => {
        this.connecting = false;
        this.ws = null;
        reject(err);
      });
    });
  }
}
