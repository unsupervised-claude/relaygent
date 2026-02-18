"""Tests for RelayRunner state machine logic."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from process import ClaudeResult
from relay import RelayRunner


def _result(**kwargs) -> ClaudeResult:
    """Build a ClaudeResult with defaults (clean exit)."""
    defaults = dict(exit_code=0, hung=False, timed_out=False,
                    no_output=False, incomplete=False, context_pct=0.0)
    return ClaudeResult(**{**defaults, **kwargs})


@pytest.fixture
def runner(tmp_path):
    """RelayRunner with mocked subprocess and timer."""
    with (
        patch("relay.acquire_lock", return_value=3),
        patch("relay.kill_orphaned_claudes"),
        patch("relay.commit_kb"),
        patch("relay.cleanup_context_file"),
        patch("relay.notify_crash"),
        patch("relay.rotate_log"),
        patch("relay.get_workspace_dir", return_value=tmp_path),
        patch("relay.cleanup_old_workspaces"),
        patch("relay.set_status"),
        patch("relay.should_sleep", return_value=True),
        patch("relay.time.sleep"),
    ):
        r = RelayRunner()
        r.timer = MagicMock()
        r.timer.start_time = 0
        r.timer.remaining.return_value = 3600
        r.timer.has_successor_time.return_value = False
        r.timer.is_expired.return_value = False
        r.sleep_mgr = MagicMock()
        r.sleep_mgr.run_wake_cycle.return_value = None
        yield r, tmp_path


def _run_with_results(runner, results):
    """Drive RelayRunner.run() feeding results one at a time, expire timer after."""
    r, tmp_path = runner
    result_iter = iter(results)

    def next_result(*_):
        try:
            return next(result_iter)
        except StopIteration:
            r.timer.is_expired.return_value = True
            return _result()

    with (
        patch("relay.ClaudeProcess") as MockCP,
        patch("relay.uuid.uuid4", return_value="test-uuid"),
    ):
        mock_claude = MagicMock()
        MockCP.return_value = mock_claude
        mock_claude.start_fresh.return_value = 0
        mock_claude.resume.return_value = 0
        mock_claude.monitor.side_effect = next_result
        r.claude = mock_claude
        return r.run()


class TestCrashCountReset:
    def test_crash_count_resets_after_clean_exit(self, runner):
        """crash_count should reset after a clean exit, not accumulate across cycles."""
        r, _ = runner
        results = [
            _result(exit_code=1),   # crash 1
            _result(exit_code=1),   # crash 2 → crash_count = 2
            _result(exit_code=0),   # clean exit → crash_count resets to 0
            _result(exit_code=1),   # crash 1 (fresh count)
            _result(exit_code=1),   # crash 2 (fresh count)
        ]
        # Should NOT give up after 5 crashes (2+1+2) — should allow 3 per clean run
        exit_code = _run_with_results(runner, results)
        assert exit_code == 0  # ran to timer expiry, didn't give up

    def test_gives_up_after_max_retries_without_reset(self, runner):
        """3 consecutive crashes (MAX_RETRIES=2 means 3 attempts) should give up."""
        r, _ = runner
        results = [
            _result(exit_code=1),  # crash 1
            _result(exit_code=1),  # crash 2
            _result(exit_code=1),  # crash 3 → exceeds MAX_RETRIES
        ]
        with patch("relay.notify_crash") as mock_notify:
            _run_with_results(runner, results)
            mock_notify.assert_called_once()


class TestIncompleteExitBackoff:
    def test_incomplete_count_resets_after_clean_exit(self, runner):
        """incomplete_count should reset after a clean exit."""
        r, _ = runner
        results = [
            _result(incomplete=True),  # incomplete 1
            _result(incomplete=True),  # incomplete 2
            _result(exit_code=0),      # clean → resets
            _result(incomplete=True),  # incomplete 1 (fresh)
        ]
        exit_code = _run_with_results(runner, results)
        assert exit_code == 0


class TestHungSession:
    def test_hung_session_resumes(self, runner):
        """Hung session should trigger resume, not fresh start."""
        r, _ = runner
        results = [
            _result(hung=True),   # hung → resume
            _result(exit_code=0), # clean
        ]
        exit_code = _run_with_results(runner, results)
        assert exit_code == 0


class TestNoOutput:
    def test_no_output_on_fresh_tries_resume(self, runner):
        """No output on fresh start → try resuming."""
        r, _ = runner
        results = [
            _result(no_output=True),  # no output on fresh
            _result(exit_code=0),     # resume works
        ]
        exit_code = _run_with_results(runner, results)
        assert exit_code == 0

    def test_no_output_on_resume_starts_fresh(self, runner):
        """No output on resume attempt → start a fresh session."""
        r, _ = runner
        results = [
            _result(exit_code=0),     # clean exit → session_established=True
            _result(no_output=True),  # no output on resume → reset to fresh
            _result(exit_code=0),     # clean on fresh
        ]
        exit_code = _run_with_results(runner, results)
        assert exit_code == 0


class TestContextFill:
    def test_context_fill_spawns_successor(self, runner):
        """Context at/above threshold with successor time → spawn successor."""
        r, _ = runner
        r.timer.has_successor_time.return_value = True
        results = [
            _result(exit_code=0, context_pct=86.0),  # context full → spawn successor
            _result(exit_code=0),                     # successor clean exit
        ]
        _run_with_results(runner, results)
        # start_fresh called at least twice: initial session + successor
        assert r.claude.start_fresh.call_count >= 2

    def test_context_fill_no_successor_time_sleeps(self, runner):
        """Context full but no successor time → go to sleep cycle instead."""
        r, _ = runner
        r.timer.has_successor_time.return_value = False
        results = [
            _result(exit_code=0, context_pct=90.0),  # context full, but no successor time
        ]
        exit_code = _run_with_results(runner, results)
        assert exit_code == 0
        # sleep cycle should have been called
        r.sleep_mgr.run_wake_cycle.assert_called_once()


class TestShouldSleepFalse:
    def test_no_stdout_resumes(self, runner):
        """should_sleep=False (no stdout marker) → resume instead of sleeping."""
        r, _ = runner
        results = [
            _result(exit_code=0),  # clean exit but should_sleep returns False → resume
            _result(exit_code=0),  # then clean
        ]
        with patch("relay.should_sleep", return_value=False):
            exit_code = _run_with_results(runner, results)
        assert exit_code == 0
        # Should have resumed (not gone to sleep cycle)
        r.sleep_mgr.run_wake_cycle.assert_not_called()
