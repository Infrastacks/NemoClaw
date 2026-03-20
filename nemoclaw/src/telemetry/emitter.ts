// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { SCHEMA_VERSION, type TelemetryEvent, type TelemetryEventType } from "./types.js";

export interface TelemetrySink {
  write(event: TelemetryEvent): void;
}

export class TelemetryEmitter {
  private readonly sandboxId: string;
  private readonly sinks: TelemetrySink[];

  constructor(opts?: { sandboxId?: string; sinks?: TelemetrySink[] }) {
    this.sandboxId = opts?.sandboxId ?? "";
    this.sinks = opts?.sinks ?? [];
  }

  emit(eventType: TelemetryEventType, data?: Record<string, unknown>): void {
    const event: TelemetryEvent = {
      schemaVersion: SCHEMA_VERSION,
      eventType,
      sandboxId: this.sandboxId,
      timestamp: new Date().toISOString(),
      data: data ?? {},
    };
    for (const sink of this.sinks) {
      sink.write(event);
    }
  }
}
