# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tests for the telemetry module — sinks, emitter, and backward-compat protocol lines."""

import json

from orchestrator.telemetry import (
    INFERENCE_CONFIGURED,
    INFERENCE_ERROR,
    INFERENCE_REQUEST,
    INFERENCE_RESPONSE,
    NETWORK_APPROVED,
    NETWORK_DENIED,
    POLICY_APPLIED,
    POLICY_DENIED,
    POLICY_EVALUATED,
    RUN_ID,
    SANDBOX_PLANNED,
    SANDBOX_PROGRESS,
    SCHEMA_VERSION,
    FileSink,
    StdoutSink,
    TelemetryEmitter,
)


class MockSink:
    def __init__(self):
        self.events: list[dict] = []

    def write(self, event: dict) -> None:
        self.events.append(event)


# --- Emitter ---


def test_emitter_emits_structured_event():
    sink = MockSink()
    emitter = TelemetryEmitter(sandbox_id="sb-1", sinks=[sink])

    emitter.emit(SANDBOX_PLANNED, {"profile": "local"})

    assert len(sink.events) == 1
    event = sink.events[0]
    assert event["schemaVersion"] == SCHEMA_VERSION
    assert event["eventType"] == SANDBOX_PLANNED
    assert event["sandboxId"] == "sb-1"
    assert "timestamp" in event
    assert event["data"] == {"profile": "local"}


def test_progress_is_drop_in_compatible():
    sink = MockSink()
    emitter = TelemetryEmitter(sinks=[sink])

    emitter.progress(50, "Checking")

    assert len(sink.events) == 1
    event = sink.events[0]
    assert event["eventType"] == SANDBOX_PROGRESS
    assert event["data"] == {"pct": 50, "label": "Checking"}


def test_emitter_multiple_sinks():
    sink_a = MockSink()
    sink_b = MockSink()
    emitter = TelemetryEmitter(sinks=[sink_a, sink_b])

    emitter.emit(SANDBOX_PLANNED)

    assert len(sink_a.events) == 1
    assert len(sink_b.events) == 1


def test_emitter_no_sinks_no_raise():
    emitter = TelemetryEmitter()
    emitter.emit(SANDBOX_PLANNED)  # should not raise


# --- StdoutSink ---


def test_stdout_sink_emits_json_line(capsys):
    sink = StdoutSink()
    event = {
        "schemaVersion": SCHEMA_VERSION,
        "eventType": SANDBOX_PLANNED,
        "sandboxId": "",
        "timestamp": "2026-01-01T00:00:00+00:00",
        "data": {},
    }

    sink.write(event)

    captured = capsys.readouterr()
    lines = captured.out.strip().split("\n")
    parsed = json.loads(lines[0])
    assert parsed["eventType"] == SANDBOX_PLANNED


def test_stdout_sink_emits_legacy_progress_line(capsys):
    sink = StdoutSink()
    event = {
        "schemaVersion": SCHEMA_VERSION,
        "eventType": SANDBOX_PROGRESS,
        "sandboxId": "",
        "timestamp": "2026-01-01T00:00:00+00:00",
        "data": {"pct": 30, "label": "Testing"},
    }

    sink.write(event)

    captured = capsys.readouterr()
    assert "PROGRESS:30:Testing" in captured.out


def test_stdout_sink_emits_legacy_run_id_line(capsys):
    sink = StdoutSink()
    event = {
        "schemaVersion": SCHEMA_VERSION,
        "eventType": RUN_ID,
        "sandboxId": "",
        "timestamp": "2026-01-01T00:00:00+00:00",
        "data": {"runId": "nc-123"},
    }

    sink.write(event)

    captured = capsys.readouterr()
    assert "RUN_ID:nc-123" in captured.out


# --- FileSink ---


def test_file_sink_appends_jsonl(tmp_path):
    path = tmp_path / "events.jsonl"
    sink = FileSink(path=path)

    event = {
        "schemaVersion": SCHEMA_VERSION,
        "eventType": SANDBOX_PLANNED,
        "sandboxId": "",
        "timestamp": "2026-01-01T00:00:00+00:00",
        "data": {"profile": "local"},
    }
    sink.write(event)
    sink.write(event)

    lines = path.read_text().strip().split("\n")
    assert len(lines) == 2
    parsed = json.loads(lines[0])
    assert parsed["eventType"] == SANDBOX_PLANNED


# --- New event constants ---


def test_inference_event_constants_are_strings():
    assert INFERENCE_CONFIGURED == "inference.configured"
    assert INFERENCE_REQUEST == "inference.request"
    assert INFERENCE_RESPONSE == "inference.response"
    assert INFERENCE_ERROR == "inference.error"


def test_policy_event_constants_are_strings():
    assert POLICY_APPLIED == "policy.applied"
    assert POLICY_EVALUATED == "policy.evaluated"
    assert POLICY_DENIED == "policy.denied"


def test_network_event_constants_are_strings():
    assert NETWORK_APPROVED == "network.approved"
    assert NETWORK_DENIED == "network.denied"


def test_emitter_emits_inference_configured_event():
    sink = MockSink()
    emitter = TelemetryEmitter(sinks=[sink])

    emitter.emit(
        INFERENCE_CONFIGURED,
        {
            "source": "inference",
            "provider": "local-nim",
            "model": "llama-3.1-8b",
            "endpoint": "http://localhost:8000/v1",
        },
    )

    assert len(sink.events) == 1
    assert sink.events[0]["eventType"] == INFERENCE_CONFIGURED
    assert sink.events[0]["data"]["source"] == "inference"
    assert sink.events[0]["data"]["provider"] == "local-nim"


def test_emitter_emits_policy_applied_event():
    sink = MockSink()
    emitter = TelemetryEmitter(sinks=[sink])

    emitter.emit(
        POLICY_APPLIED,
        {
            "source": "policy",
            "policies": ["nim_service"],
        },
    )

    assert len(sink.events) == 1
    assert sink.events[0]["eventType"] == POLICY_APPLIED
    assert sink.events[0]["data"]["policies"] == ["nim_service"]
