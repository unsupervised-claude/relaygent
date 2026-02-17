"""Tests for configuration and Timer."""

from __future__ import annotations

import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import Timer, cleanup_old_workspaces, get_workspace_dir


class TestTimer:
    def test_elapsed_increases(self):
        t = Timer()
        time.sleep(0.05)
        assert t.elapsed() >= 0

    def test_never_expires(self):
        t = Timer()
        assert t.is_expired() is False

    def test_remaining_is_large(self):
        t = Timer()
        assert t.remaining() > 9000

    def test_always_has_successor_time(self):
        t = Timer()
        assert t.has_successor_time() is True


class TestGetWorkspaceDir:
    def test_creates_directory(self, tmp_path, monkeypatch):
        monkeypatch.setattr("config.RUNS_DIR", tmp_path / "runs")
        ws = get_workspace_dir()
        assert ws.exists()
        assert ws.is_dir()
        assert ws.parent == tmp_path / "runs"

    def test_unique_names(self, tmp_path, monkeypatch):
        monkeypatch.setattr("config.RUNS_DIR", tmp_path / "runs")
        ws1 = get_workspace_dir()
        # Tiny delay to get different timestamp
        time.sleep(1.1)
        ws2 = get_workspace_dir()
        assert ws1 != ws2


class TestCleanupOldWorkspaces:
    def test_removes_old_directories(self, tmp_path, monkeypatch):
        monkeypatch.setattr("config.RUNS_DIR", tmp_path)
        old_dir = tmp_path / "2020-01-01-00-00-00"
        old_dir.mkdir()
        # Set mtime to 30 days ago
        old_time = time.time() - (30 * 86400)
        import os
        os.utime(old_dir, (old_time, old_time))

        new_dir = tmp_path / "2026-02-16-12-00-00"
        new_dir.mkdir()

        cleanup_old_workspaces(days=7)
        assert not old_dir.exists()
        assert new_dir.exists()

    def test_keeps_recent_directories(self, tmp_path, monkeypatch):
        monkeypatch.setattr("config.RUNS_DIR", tmp_path)
        recent = tmp_path / "recent-run"
        recent.mkdir()

        cleanup_old_workspaces(days=7)
        assert recent.exists()

    def test_handles_missing_runs_dir(self, tmp_path, monkeypatch):
        monkeypatch.setattr("config.RUNS_DIR", tmp_path / "nonexistent")
        # Should not raise
        cleanup_old_workspaces(days=7)
