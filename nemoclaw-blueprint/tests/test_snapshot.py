# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tests for snapshot/restore migration logic."""

import json

from migrations.snapshot import create_snapshot, list_snapshots, rollback_from_snapshot


def test_create_snapshot_returns_none_when_no_openclaw(monkeypatch, tmp_path):
    """create_snapshot must return None (not crash) when ~/.openclaw doesn't exist."""
    monkeypatch.setattr("migrations.snapshot.OPENCLAW_DIR", tmp_path / "nonexistent")
    monkeypatch.setattr("migrations.snapshot.SNAPSHOTS_DIR", tmp_path / "snapshots")

    result = create_snapshot()
    assert result is None


def test_create_snapshot_captures_files_and_manifest(monkeypatch, tmp_path):
    """Snapshot must copy all files and write a manifest with correct file_count."""
    openclaw_dir = tmp_path / ".openclaw"
    openclaw_dir.mkdir()
    (openclaw_dir / "config.yaml").write_text("model: llama")
    (openclaw_dir / "skills").mkdir()
    (openclaw_dir / "skills" / "greeting.md").write_text("Hello")

    snapshots_dir = tmp_path / "snapshots"
    monkeypatch.setattr("migrations.snapshot.OPENCLAW_DIR", openclaw_dir)
    monkeypatch.setattr("migrations.snapshot.SNAPSHOTS_DIR", snapshots_dir)

    snap = create_snapshot()
    assert snap is not None
    assert snap.exists()

    manifest = json.loads((snap / "snapshot.json").read_text())
    assert manifest["file_count"] == 2
    assert "config.yaml" in manifest["contents"]
    assert any("greeting.md" in c for c in manifest["contents"])

    # Verify actual files were copied
    assert (snap / "openclaw" / "config.yaml").read_text() == "model: llama"


def test_rollback_restores_from_snapshot(monkeypatch, tmp_path):
    """Rollback must restore snapshot contents to the openclaw directory."""
    openclaw_dir = tmp_path / ".openclaw"
    snapshot_dir = tmp_path / "snap"
    source = snapshot_dir / "openclaw"
    source.mkdir(parents=True)
    (source / "config.yaml").write_text("restored: true")

    monkeypatch.setattr("migrations.snapshot.OPENCLAW_DIR", openclaw_dir)

    result = rollback_from_snapshot(snapshot_dir)
    assert result is True
    assert (openclaw_dir / "config.yaml").read_text() == "restored: true"


def test_rollback_archives_existing_config(monkeypatch, tmp_path):
    """Rollback must archive the current config before restoring — not silently overwrite."""
    openclaw_dir = tmp_path / ".openclaw"
    openclaw_dir.mkdir()
    (openclaw_dir / "config.yaml").write_text("current")

    snapshot_dir = tmp_path / "snap"
    source = snapshot_dir / "openclaw"
    source.mkdir(parents=True)
    (source / "config.yaml").write_text("old")

    monkeypatch.setattr("migrations.snapshot.OPENCLAW_DIR", openclaw_dir)

    rollback_from_snapshot(snapshot_dir)

    # Current config should be archived (moved to a timestamped path)
    assert (openclaw_dir / "config.yaml").read_text() == "old"
    # The parent dir should now contain the archived version
    archived = [p for p in tmp_path.iterdir() if "nemoclaw-archived" in p.name]
    assert len(archived) == 1


def test_rollback_fails_when_snapshot_missing(tmp_path):
    """Rollback with a snapshot dir that has no openclaw/ subfolder must return False."""
    empty_snap = tmp_path / "empty-snap"
    empty_snap.mkdir()
    assert rollback_from_snapshot(empty_snap) is False


def test_list_snapshots_empty_when_no_dir(monkeypatch, tmp_path):
    """list_snapshots must return [] when the snapshots directory doesn't exist yet."""
    monkeypatch.setattr("migrations.snapshot.SNAPSHOTS_DIR", tmp_path / "nonexistent")
    assert list_snapshots() == []


def test_list_snapshots_returns_manifests(monkeypatch, tmp_path):
    """list_snapshots must return manifests sorted newest-first."""
    snapshots_dir = tmp_path / "snapshots"

    for ts in ["20260101T000000Z", "20260201T000000Z"]:
        d = snapshots_dir / ts
        d.mkdir(parents=True)
        (d / "snapshot.json").write_text(
            json.dumps({"timestamp": ts, "source": "/home/.openclaw", "file_count": 1})
        )

    monkeypatch.setattr("migrations.snapshot.SNAPSHOTS_DIR", snapshots_dir)
    snaps = list_snapshots()

    assert len(snaps) == 2
    assert snaps[0]["timestamp"] == "20260201T000000Z"  # newest first
    assert "path" in snaps[0]
