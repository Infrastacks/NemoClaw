# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Structured telemetry for NemoClaw blueprint orchestration.

Provides a sink-based emitter that wraps the existing ``on_progress`` callback
signature (``Callable[[int, str], None]``) so callers can subscribe to
structured JSON-line events without changing core.py.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

# ---------------------------------------------------------------------------
# Event-type constants
# ---------------------------------------------------------------------------

# Sandbox lifecycle
SANDBOX_PROGRESS = "sandbox.progress"
SANDBOX_PLANNED = "sandbox.planned"
SANDBOX_CREATED = "sandbox.created"
SANDBOX_DESTROYED = "sandbox.destroyed"
SANDBOX_ERROR = "sandbox.error"
RUN_ID = "run.id"

# Inference lifecycle
INFERENCE_CONFIGURED = "inference.configured"
INFERENCE_REQUEST = "inference.request"
INFERENCE_RESPONSE = "inference.response"
INFERENCE_ERROR = "inference.error"

# Policy lifecycle
POLICY_APPLIED = "policy.applied"
POLICY_EVALUATED = "policy.evaluated"
POLICY_DENIED = "policy.denied"

# Network lifecycle
NETWORK_APPROVED = "network.approved"
NETWORK_DENIED = "network.denied"
NETWORK_CONNECTED = "network.connected"
NETWORK_DISCONNECTED = "network.disconnected"

# Agent lifecycle
AGENT_HEARTBEAT = "agent.heartbeat"

SCHEMA_VERSION = "1.0"


# ---------------------------------------------------------------------------
# Sink protocol
# ---------------------------------------------------------------------------


class TelemetrySink(Protocol):
    def write(self, event: dict[str, Any]) -> None: ...


# ---------------------------------------------------------------------------
# Concrete sinks
# ---------------------------------------------------------------------------


class StdoutSink:
    """Writes compact JSON to stdout, plus legacy protocol lines for backward compat."""

    def write(self, event: dict[str, Any]) -> None:
        print(json.dumps(event, separators=(",", ":")), flush=True)

        event_type = event.get("eventType", "")
        data = event.get("data", {})

        if event_type == SANDBOX_PROGRESS:
            pct = data.get("pct", 0)
            label = data.get("label", "")
            print(f"PROGRESS:{pct}:{label}", flush=True)
        elif event_type == RUN_ID:
            run_id = data.get("runId", "")
            print(f"RUN_ID:{run_id}", flush=True)


class FileSink:
    """Appends JSON lines to a file (default ``~/.nemoclaw/events.jsonl``)."""

    def __init__(self, path: str | Path | None = None) -> None:
        self._path = Path(path) if path else Path.home() / ".nemoclaw" / "events.jsonl"

    def write(self, event: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a") as f:
            f.write(json.dumps(event, separators=(",", ":")) + "\n")


# ---------------------------------------------------------------------------
# Emitter
# ---------------------------------------------------------------------------


class TelemetryEmitter:
    """Fan-out emitter with a ``progress()`` method that is a drop-in for
    ``core.ProgressCallback = Callable[[int, str], None]``.
    """

    def __init__(
        self,
        *,
        sandbox_id: str = "",
        sinks: list[TelemetrySink] | None = None,
    ) -> None:
        self._sandbox_id = sandbox_id
        self._sinks: list[TelemetrySink] = sinks or []

    def emit(self, event_type: str, data: dict[str, Any] | None = None) -> None:
        event: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "eventType": event_type,
            "sandboxId": self._sandbox_id,
            "timestamp": datetime.now(UTC).isoformat(),
            "data": data or {},
        }
        for sink in self._sinks:
            sink.write(event)

    def progress(self, pct: int, label: str) -> None:
        """Drop-in replacement for ``on_progress: Callable[[int, str], None]``."""
        self.emit(SANDBOX_PROGRESS, {"pct": pct, "label": label})
