# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Proxy log parser and watcher for policy decision telemetry.

Parses structured proxy log lines into policy decision events
and emits ``policy.evaluated`` / ``policy.denied`` telemetry.
"""

from __future__ import annotations

import re
import threading
import time
from pathlib import Path
from typing import IO, Any

from orchestrator.telemetry import (
    NETWORK_APPROVED,
    NETWORK_DENIED,
    POLICY_DENIED,
    POLICY_EVALUATED,
    TelemetryEmitter,
)

# Expected proxy log format:
# [ISO8601] POLICY decision=allow|deny policy=<name> dest=<host:port>
#   method=<M> path=<P>
_KV_RE = re.compile(r"(\w+)=([\S]+)")
_DECISION_RE = re.compile(r"\[(?P<ts>[^\]]+)\]\s+POLICY\s+(?P<kvs>.+)")


class ProxyLogParser:
    """Parses proxy log lines into policy decision dicts."""

    def parse_line(self, line: str) -> dict[str, str] | None:
        line = line.strip()
        m = _DECISION_RE.match(line)
        if not m:
            return None

        kvs = dict(_KV_RE.findall(m.group("kvs")))
        decision = kvs.get("decision")
        if decision not in ("allow", "deny"):
            return None

        return {
            "timestamp": m.group("ts"),
            "decision": decision,
            "policy": kvs.get("policy", ""),
            "dest": kvs.get("dest", ""),
            "method": kvs.get("method", ""),
            "path": kvs.get("path", ""),
        }


class ProxyLogWatcher:
    """Tails a log source and emits policy telemetry events."""

    def __init__(self, emitter: TelemetryEmitter, parser: ProxyLogParser | None = None) -> None:
        self._emitter = emitter
        self._parser = parser or ProxyLogParser()
        self._stop_event = threading.Event()

    def process_line(self, line: str) -> None:
        """Parse one line and emit the corresponding telemetry event if valid."""
        parsed = self._parser.parse_line(line)
        if not parsed:
            return

        policy_name = parsed["policy"]
        data: dict[str, Any] = {
            "source": "openshell",
            "policy": policy_name,
            "rule_id": policy_name,
            "dest": parsed["dest"],
            "method": parsed["method"],
            "path": parsed["path"],
            "timestamp": parsed["timestamp"],
        }

        if parsed["decision"] == "allow":
            self._emitter.emit(POLICY_EVALUATED, data)
            self._emitter.emit(NETWORK_APPROVED, data)
        else:
            deny_data = {**data, "reason": f"Policy denied by {policy_name}"}
            self._emitter.emit(POLICY_DENIED, deny_data)
            self._emitter.emit(NETWORK_DENIED, deny_data)

    def process_stream(self, stream: IO[str]) -> None:
        """Process all lines from a stream."""
        for line in stream:
            self.process_line(line)

    def stop(self) -> None:
        """Signal the tail loop to stop."""
        self._stop_event.set()

    def tail_file(self, path: Path, *, poll_interval: float = 1.0) -> None:
        """Tail a log file, emitting events as new lines appear.

        Blocks until :meth:`stop` is called or the thread is interrupted.
        Starts from the current end of file.
        """
        with path.open() as f:
            f.seek(0, 2)  # Seek to end
            while not self._stop_event.is_set():
                line = f.readline()
                if line:
                    self.process_line(line)
                else:
                    self._stop_event.wait(poll_interval)
