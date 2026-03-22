// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { open, watch } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { RawEvent } from "./event-mapper.js";

export type EventHandler = (event: RawEvent) => void;

/**
 * Tails a JSONL file and emits parsed events.
 * Each instance is independent — no shared singleton state.
 */
export class EventTailer {
  private readonly path: string;
  private readonly onEvent: EventHandler;
  private handle: FileHandle | null = null;
  private offset = 0;
  private abortController: AbortController | null = null;
  private buffer = "";

  constructor(path: string, onEvent: EventHandler) {
    this.path = path;
    this.onEvent = onEvent;
  }

  async start(): Promise<void> {
    try {
      this.handle = await open(this.path, "r");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      await this.waitForFile();
      this.handle = await open(this.path, "r");
    }

    const info = await this.handle.stat();
    this.offset = info.size;

    this.abortController = new AbortController();
    this.watch();
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    await this.handle?.close();
    this.handle = null;
  }

  private async waitForFile(): Promise<void> {
    const dir = dirname(this.path);
    const filename = basename(this.path);

    const ac = new AbortController();
    this.abortController = ac;

    try {
      const watcher = watch(dir, { signal: ac.signal });
      for await (const event of watcher) {
        if (event.filename === filename) break;
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).name === "AbortError") return;
      throw err;
    }

    this.abortController = null;
  }

  private async watch(): Promise<void> {
    const ac = this.abortController!;

    try {
      const watcher = watch(this.path, { signal: ac.signal });
      for await (const _ of watcher) {
        await this.readNewLines();
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).name === "AbortError") return;
      throw err;
    }
  }

  private async readNewLines(): Promise<void> {
    if (!this.handle) return;

    const chunk = Buffer.alloc(8192);
    const { bytesRead } = await this.handle.read(chunk, 0, chunk.length, this.offset);
    if (bytesRead === 0) return;

    this.offset += bytesRead;
    this.buffer += chunk.toString("utf8", 0, bytesRead);

    const lines = this.buffer.split("\n");
    // Keep the last partial line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== "{") continue;

      try {
        const parsed = JSON.parse(trimmed) as RawEvent;
        if (parsed.eventType) {
          this.onEvent(parsed);
        }
      } catch {
        // Malformed JSON — skip
      }
    }
  }
}
