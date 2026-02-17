"""Tests for relay utility functions."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from relay_utils import cleanup_context_file, rotate_log


class TestRotateLog:
    def test_rotates_oversized_log(self, tmp_path, monkeypatch):
        log_file = tmp_path / "test.log"
        monkeypatch.setattr("relay_utils.LOG_FILE", log_file)
        monkeypatch.setattr("relay_utils.LOG_MAX_SIZE", 100)
        monkeypatch.setattr("relay_utils.LOG_TRUNCATE_SIZE", 50)

        # Write 200 bytes of log lines
        lines = [f"[2026-02-16] Log line {i:03d}\n" for i in range(10)]
        log_file.write_text("".join(lines))
        original_size = log_file.stat().st_size
        assert original_size > 100

        rotate_log()
        new_size = log_file.stat().st_size
        assert new_size < original_size
        assert new_size <= 50

        # Content should start at a complete line
        content = log_file.read_text()
        assert not content.startswith("\n")
        assert content.endswith("\n")

    def test_no_rotation_for_small_log(self, tmp_path, monkeypatch):
        log_file = tmp_path / "small.log"
        monkeypatch.setattr("relay_utils.LOG_FILE", log_file)
        monkeypatch.setattr("relay_utils.LOG_MAX_SIZE", 10000)

        log_file.write_text("Small log\n")
        original = log_file.read_text()

        rotate_log()
        assert log_file.read_text() == original

    def test_no_error_for_missing_log(self, tmp_path, monkeypatch):
        log_file = tmp_path / "missing.log"
        monkeypatch.setattr("relay_utils.LOG_FILE", log_file)
        # Should not raise
        rotate_log()


class TestCleanupContextFile:
    def test_removes_context_file(self, tmp_path):
        pct_file = tmp_path / "relaygent-context-pct"
        pct_file.write_text("85.3")

        with patch("relay_utils.Path", return_value=pct_file):
            cleanup_context_file()
        assert not pct_file.exists()

    def test_no_error_if_missing(self, tmp_path):
        pct_file = tmp_path / "nonexistent"
        with patch("relay_utils.Path", return_value=pct_file):
            cleanup_context_file()  # Should not raise
