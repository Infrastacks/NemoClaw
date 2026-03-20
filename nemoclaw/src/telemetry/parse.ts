// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { TelemetryEvent } from "./types.js";

/**
 * Try to parse a single line as a structured telemetry event.
 * Returns null for non-telemetry lines (legacy PROGRESS:, RUN_ID:, log output, partial JSON).
 */
export function parseTelemetryLine(line: string): TelemetryEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.schemaVersion === "string" &&
      typeof parsed.eventType === "string"
    ) {
      return parsed as TelemetryEvent;
    }
  } catch {
    // Not valid JSON — ignore
  }

  return null;
}
