#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { Agent } from "./agent.js";

const program = new Command()
  .name("nemoclaw-agent")
  .description("Codicera agent sidecar — tails NemoClaw telemetry and forwards to Codicera")
  .requiredOption("--ws-url <url>", "WebSocket endpoint for telemetry delivery")
  .option("--events-log-path <path>", "Path to NemoClaw events.jsonl")
  .option("--behavior-log-path <path>", "Path to behavior events log (agent actions, file ops, PR events)")
  .option("--batch-size <n>", "Events per batch", parseInt)
  .option("--flush-interval <ms>", "Flush interval in milliseconds", parseInt)
  .parse();

const opts = program.opts<{
  wsUrl: string;
  eventsLogPath?: string;
  behaviorLogPath?: string;
  batchSize?: number;
  flushInterval?: number;
}>();

const agent = new Agent({
  wsUrl: opts.wsUrl,
  eventsLogPath: opts.eventsLogPath,
  behaviorLogPath: opts.behaviorLogPath,
  batchSize: opts.batchSize,
  flushIntervalMs: opts.flushInterval,
});

agent.start().catch((err) => {
  console.error("Agent failed to start:", err);
  process.exit(1);
});

const shutdown = async () => {
  await agent.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
