# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tests for proxy log parser and watcher."""

import io

from orchestrator.proxy_watcher import ProxyLogParser, ProxyLogWatcher
from orchestrator.telemetry import (
    NETWORK_APPROVED,
    NETWORK_DENIED,
    POLICY_DENIED,
    POLICY_EVALUATED,
    TelemetryEmitter,
)


class MockSink:
    def __init__(self):
        self.events: list[dict] = []

    def write(self, event: dict) -> None:
        self.events.append(event)


# --- ProxyLogParser ---


def test_parser_allow_decision():
    parser = ProxyLogParser()
    result = parser.parse_line(
        "[2026-03-22T10:30:00Z] POLICY decision=allow policy=nim_service "
        "dest=nim-service.local:443 method=GET path=/v1/models"
    )
    assert result is not None
    assert result["decision"] == "allow"
    assert result["policy"] == "nim_service"
    assert result["dest"] == "nim-service.local:443"
    assert result["method"] == "GET"
    assert result["path"] == "/v1/models"
    assert result["timestamp"] == "2026-03-22T10:30:00Z"


def test_parser_deny_decision():
    parser = ProxyLogParser()
    result = parser.parse_line(
        "[2026-03-22T10:31:00Z] POLICY decision=deny policy=egress "
        "dest=evil.com:80 method=POST path=/exfil"
    )
    assert result is not None
    assert result["decision"] == "deny"
    assert result["policy"] == "egress"


def test_parser_returns_none_for_non_policy_lines():
    parser = ProxyLogParser()
    assert parser.parse_line("[2026-03-22T10:30:00Z] INFO started") is None
    assert parser.parse_line("") is None
    assert parser.parse_line("just some text") is None


def test_parser_returns_none_for_invalid_decision():
    parser = ProxyLogParser()
    result = parser.parse_line(
        "[2026-03-22T10:30:00Z] POLICY decision=maybe policy=test dest=x:80 method=GET path=/"
    )
    assert result is None


# --- ProxyLogWatcher ---


def test_watcher_emits_policy_evaluated_and_network_approved_on_allow():
    sink = MockSink()
    emitter = TelemetryEmitter(sinks=[sink])
    watcher = ProxyLogWatcher(emitter)

    watcher.process_line(
        "[2026-03-22T10:30:00Z] POLICY decision=allow policy=nim "
        "dest=nim.local:443 method=GET path=/v1/models"
    )

    assert len(sink.events) == 2
    assert sink.events[0]["eventType"] == POLICY_EVALUATED
    assert sink.events[0]["data"]["policy"] == "nim"
    assert sink.events[0]["data"]["rule_id"] == "nim"
    assert sink.events[0]["data"]["source"] == "openshell"
    assert sink.events[1]["eventType"] == NETWORK_APPROVED
    assert sink.events[1]["data"]["policy"] == "nim"
    assert sink.events[1]["data"]["source"] == "openshell"


def test_watcher_emits_policy_denied_and_network_denied_on_deny():
    sink = MockSink()
    emitter = TelemetryEmitter(sinks=[sink])
    watcher = ProxyLogWatcher(emitter)

    watcher.process_line(
        "[2026-03-22T10:31:00Z] POLICY decision=deny policy=egress "
        "dest=evil.com:80 method=POST path=/exfil"
    )

    assert len(sink.events) == 2
    assert sink.events[0]["eventType"] == POLICY_DENIED
    assert sink.events[0]["data"]["policy"] == "egress"
    assert sink.events[0]["data"]["rule_id"] == "egress"
    assert sink.events[0]["data"]["reason"] == "Policy denied by egress"
    assert sink.events[1]["eventType"] == NETWORK_DENIED
    assert sink.events[1]["data"]["reason"] == "Policy denied by egress"


def test_watcher_ignores_non_policy_lines():
    sink = MockSink()
    emitter = TelemetryEmitter(sinks=[sink])
    watcher = ProxyLogWatcher(emitter)

    watcher.process_line("[2026-03-22T10:30:00Z] INFO started")
    watcher.process_line("")

    assert len(sink.events) == 0


def test_watcher_process_stream():
    sink = MockSink()
    emitter = TelemetryEmitter(sinks=[sink])
    watcher = ProxyLogWatcher(emitter)

    lines = io.StringIO(
        "[2026-03-22T10:30:00Z] POLICY decision=allow policy=a dest=a:1 method=GET path=/\n"
        "[2026-03-22T10:30:01Z] INFO noise\n"
        "[2026-03-22T10:30:02Z] POLICY decision=deny policy=b dest=b:2 method=POST path=/x\n"
    )
    watcher.process_stream(lines)

    assert len(sink.events) == 4
    assert sink.events[0]["eventType"] == POLICY_EVALUATED
    assert sink.events[1]["eventType"] == NETWORK_APPROVED
    assert sink.events[2]["eventType"] == POLICY_DENIED
    assert sink.events[3]["eventType"] == NETWORK_DENIED
