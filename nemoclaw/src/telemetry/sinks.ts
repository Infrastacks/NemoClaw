// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { TelemetrySink } from "./emitter.js";
import type { TelemetryEvent } from "./types.js";

export class StdoutSink implements TelemetrySink {
  write(event: TelemetryEvent): void {
    process.stdout.write(JSON.stringify(event) + "\n");
  }
}

export class FileSink implements TelemetrySink {
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? join(homedir(), ".nemoclaw", "events.jsonl");
  }

  write(event: TelemetryEvent): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(event) + "\n");
  }
}
