"""Tests that RelayRunner passes the correct resume message per failure mode."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from process import ClaudeResult
from relay import RelayRunner


def _result(**kwargs) -> ClaudeResult:
    defaults = dict(exit_code=0, hung=False, timed_out=False,
                    no_output=False, incomplete=False, context_pct=0.0)
    return ClaudeResult(**{**defaults, **kwargs})


@pytest.fixture
def runner(tmp_path):
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


def _capture_resume_calls(runner, results, should_sleep_val=True):
    """Run relay with given results, return list of resume() call args."""
    r, _ = runner
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
        patch("relay.should_sleep", return_value=should_sleep_val),
    ):
        mock_claude = MagicMock()
        MockCP.return_value = mock_claude
        mock_claude.start_fresh.return_value = 0
        mock_claude.resume.return_value = 0
        mock_claude.monitor.side_effect = next_result
        r.claude = mock_claude
        r.run()
        return [c.args[0] for c in mock_claude.resume.call_args_list]


class TestHungResumeMessage:
    def test_hung_uses_api_error_message(self, runner):
        results = [_result(hung=True), _result(exit_code=0)]
        msgs = _capture_resume_calls(runner, results)
        assert len(msgs) == 1
        assert "API error" in msgs[0]
        # Must NOT say "API call failed after" (silence timeout message)
        assert "API call failed after" not in msgs[0]


class TestIncompleteResumeMessage:
    def test_incomplete_uses_continue_message(self, runner):
        results = [_result(incomplete=True), _result(exit_code=0)]
        msgs = _capture_resume_calls(runner, results)
        assert len(msgs) == 1
        assert "continue" in msgs[0].lower()

    def test_incomplete_not_silence_timeout_message(self, runner):
        results = [_result(incomplete=True), _result(exit_code=0)]
        msgs = _capture_resume_calls(runner, results)
        assert "API call failed after" not in msgs[0]


class TestNoOutputResumeMessage:
    def test_no_output_on_fresh_uses_no_output_message(self, runner):
        results = [_result(no_output=True), _result(exit_code=0)]
        msgs = _capture_resume_calls(runner, results)
        assert len(msgs) == 1
        assert "output" in msgs[0].lower()

    def test_no_output_message_not_api_error(self, runner):
        results = [_result(no_output=True), _result(exit_code=0)]
        msgs = _capture_resume_calls(runner, results)
        assert "API error" not in msgs[0]


class TestSilenceTimeoutResumeMessage:
    def test_no_stdout_uses_silence_timeout_message(self, runner):
        r, tmp = runner
        result_iter = iter([_result(exit_code=0), _result(exit_code=0)])
        should_sleep_calls = [False, True]  # First: no stdout → resume; second: sleep → break

        def next_result(*_):
            try:
                return next(result_iter)
            except StopIteration:
                r.timer.is_expired.return_value = True
                return _result()

        with (
            patch("relay.ClaudeProcess") as MockCP,
            patch("relay.uuid.uuid4", return_value="test-uuid"),
            patch("relay.should_sleep", side_effect=should_sleep_calls),
        ):
            mock_claude = MagicMock()
            MockCP.return_value = mock_claude
            mock_claude.start_fresh.return_value = 0
            mock_claude.resume.return_value = 0
            mock_claude.monitor.side_effect = next_result
            r.claude = mock_claude
            r.run()
            msgs = [c.args[0] for c in mock_claude.resume.call_args_list]

        assert len(msgs) == 1
        assert "API call failed after" in msgs[0]


class TestEachCaseDistinct:
    def test_hung_message_does_not_say_continue(self, runner):
        """Hung message should describe the error, not just say 'continue'."""
        results = [_result(hung=True), _result(exit_code=0)]
        msgs = _capture_resume_calls(runner, results)
        assert "continue" not in msgs[0].lower()

    def test_incomplete_message_does_not_say_api_error(self, runner):
        """Incomplete exit message should not describe an API error."""
        results = [_result(incomplete=True), _result(exit_code=0)]
        msgs = _capture_resume_calls(runner, results)
        assert "API error" not in msgs[0]
