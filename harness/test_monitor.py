"""Tests for ClaudeProcess.monitor() — the main monitoring loop."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from config import Timer
from process import ClaudeProcess


def _make_process(tmp_path):
    """Create a ClaudeProcess with a mocked subprocess."""
    p = ClaudeProcess("test-session", Timer(), tmp_path)
    mock_proc = MagicMock()
    mock_proc.returncode = 0
    mock_proc.wait.return_value = None
    p.process = mock_proc
    return p


class TestMonitorNormalExit:
    def test_returns_exit_code(self, tmp_path):
        p = _make_process(tmp_path)
        p.process.poll.return_value = 0  # Already exited — skip while loop
        p.process.returncode = 42
        with patch("process.get_jsonl_size", return_value=100), \
             patch("process.check_incomplete_exit", return_value=(False, None)):
            result = p.monitor(0)
        assert result.exit_code == 42
        assert not result.hung and not result.timed_out

    def test_no_output_when_jsonl_unchanged(self, tmp_path):
        p = _make_process(tmp_path)
        p.process.poll.return_value = 0
        with patch("process.get_jsonl_size", return_value=0), \
             patch("process.check_incomplete_exit", return_value=(False, None)):
            result = p.monitor(0)
        assert result.no_output is True

    def test_has_output_when_jsonl_grew(self, tmp_path):
        p = _make_process(tmp_path)
        p.process.poll.return_value = 0
        with patch("process.get_jsonl_size", side_effect=[100, 200]), \
             patch("process.check_incomplete_exit", return_value=(False, None)):
            result = p.monitor(0)
        assert result.no_output is False

    def test_incomplete_flag_from_jsonl(self, tmp_path):
        p = _make_process(tmp_path)
        p.process.poll.return_value = 0
        with patch("process.get_jsonl_size", return_value=100), \
             patch("process.check_incomplete_exit", return_value=(True, "reason")):
            result = p.monitor(0)
        assert result.incomplete is True


class TestMonitorSilenceTimeout:
    def test_detects_silence_hang(self, tmp_path, monkeypatch):
        import process as proc_mod
        monkeypatch.setattr(proc_mod, "SILENCE_TIMEOUT", 10)
        monkeypatch.setattr(proc_mod, "HANG_CHECK_DELAY", 9999)
        p = _make_process(tmp_path)
        # First poll=None (enter loop), second poll=None (after _terminate)
        p.process.poll.side_effect = [None, 0, 0]
        # time calls: attempt_start, last_activity_time, elapsed, activity_check, silence_check
        times = iter([0, 0, 0, 20, 20])
        with patch("process.time.time", side_effect=times), \
             patch("process.time.sleep"), \
             patch("process.get_jsonl_size", return_value=0), \
             patch("process.check_incomplete_exit", return_value=(False, None)):
            result = p.monitor(0)
        assert result.hung is True


class TestMonitorContextWarning:
    def test_sends_warning_once(self, tmp_path, capsys):
        p = _make_process(tmp_path)
        # One loop iteration then exit
        p.process.poll.side_effect = [None, 0, 0]
        with patch("process.time.time", return_value=0), \
             patch("process.time.sleep"), \
             patch("process.get_jsonl_size", return_value=100), \
             patch("process.check_incomplete_exit", return_value=(False, None)):
            p.get_context_fill = lambda: 90.0
            result = p.monitor(0)
        assert p._context_warning_sent is True
        output = capsys.readouterr().out
        assert "90%" in output

    def test_no_warning_below_threshold(self, tmp_path):
        p = _make_process(tmp_path)
        p.process.poll.side_effect = [None, 0, 0]
        with patch("process.time.time", return_value=0), \
             patch("process.time.sleep"), \
             patch("process.get_jsonl_size", return_value=100), \
             patch("process.check_incomplete_exit", return_value=(False, None)):
            p.get_context_fill = lambda: 50.0
            p.monitor(0)
        assert p._context_warning_sent is False


class TestMonitorContextPct:
    def test_returns_context_pct(self, tmp_path):
        p = _make_process(tmp_path)
        p.process.poll.return_value = 0
        with patch("process.get_jsonl_size", return_value=100), \
             patch("process.check_incomplete_exit", return_value=(False, None)):
            p.get_context_fill = lambda: 73.5
            result = p.monitor(0)
        assert result.context_pct == 73.5
