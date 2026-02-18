"""Tests for sleep/wake handling (session.py)."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from session import SleepManager, SleepResult, MAX_CACHE_STALE


@pytest.fixture
def timer():
    t = MagicMock()
    t.is_expired.return_value = False
    return t


@pytest.fixture
def cache_file(tmp_path, monkeypatch):
    cache = tmp_path / "cache.json"
    monkeypatch.setattr("session.NOTIFICATIONS_CACHE", str(cache))
    return cache


def msg_notif(ts="t1", content="hi"):
    return [{"type": "message", "messages": [{"timestamp": ts, "content": content}]}]


class TestExtractTimestamps:
    def test_chat_message_timestamps(self, timer):
        mgr = SleepManager(timer)
        ts = mgr._extract_timestamps({"messages": [{"timestamp": "t1"}, {"timestamp": "t2"}]})
        assert ts == {"t1", "t2"}

    def test_reminder_id(self, timer):
        mgr = SleepManager(timer)
        assert "reminder-42" in mgr._extract_timestamps({"type": "reminder", "id": 42})

    def test_slack_channel_dedup(self, timer):
        mgr = SleepManager(timer)
        notif = {"source": "slack", "channels": [{"id": "C123", "unread": 3}]}
        assert "slack-C123-3" in mgr._extract_timestamps(notif)

    def test_slack_unread_count_change(self, timer):
        mgr = SleepManager(timer)
        mk = lambda n: {"source": "slack", "channels": [{"id": "C1", "unread": n}]}
        assert mgr._extract_timestamps(mk(2)) != mgr._extract_timestamps(mk(3))

    def test_fallback_for_no_keys(self, timer):
        mgr = SleepManager(timer)
        ts = mgr._extract_timestamps({"type": "unknown", "source": "test", "count": 1})
        assert ts == {"unknown-test-1"}

    def test_empty_notif_with_type(self, timer):
        assert len(SleepManager(timer)._extract_timestamps({"type": "system"})) == 1


class TestCheckNotifications:
    def test_returns_new_notifications(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text(json.dumps(msg_notif()))
        result = mgr._check_notifications()
        assert len(result) == 1 and result[0]["type"] == "message"

    def test_dedup_same_notification(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text(json.dumps(msg_notif()))
        assert len(mgr._check_notifications()) == 1
        assert len(mgr._check_notifications()) == 0

    def test_new_message_after_dedup(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text(json.dumps(msg_notif("t1", "first")))
        mgr._check_notifications()
        cache_file.write_text(json.dumps(msg_notif("t2", "second")))
        assert len(mgr._check_notifications()) == 1

    def test_missing_cache_file(self, timer, cache_file):
        assert SleepManager(timer)._check_notifications() == []

    def test_malformed_json(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text("NOT JSON")
        assert mgr._check_notifications() == []


class TestSlackDedupPersistence:
    def test_slack_keys_persist_across_sleep(self, timer, cache_file):
        """Slack dedup keys must NOT be cleared on sleep — prevents phantom wake loop."""
        mgr = SleepManager(timer)
        slack_notif = [{"source": "slack", "channels": [{"id": "C1", "unread": 1}]}]
        cache_file.write_text(json.dumps(slack_notif))
        with patch("session.set_status"), patch("session.log"):
            mgr._wait_for_wake()
        # Same notification should be deduped on next wake attempt
        cache_file.write_text(json.dumps(slack_notif))
        result = mgr._check_notifications()
        assert len(result) == 0, "Same Slack unread count should not re-trigger wake"


class TestWaitForWake:
    def test_wakes_on_notification(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text(json.dumps(msg_notif()))
        with patch("session.set_status"), patch("session.log"):
            woken, notifs = mgr._wait_for_wake()
        assert woken is True and len(notifs) == 1

    def test_returns_false_on_timer_expiry(self, timer, cache_file):
        timer.is_expired.return_value = True
        mgr = SleepManager(timer)
        cache_file.write_text("[]")
        with patch("session.set_status"), patch("session.log"), \
             patch("session.time.sleep"):
            woken, notifs = mgr._wait_for_wake()
        assert woken is False and notifs == []

    def test_force_wake_on_stale_cache(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text("[]")
        os.utime(str(cache_file), (0, time.time() - MAX_CACHE_STALE - 10))
        with patch("session.set_status"), patch("session.log"):
            woken, notifs = mgr._wait_for_wake()
        assert woken and notifs[0]["type"] == "system"


class TestAutoSleepAndWake:
    def test_returns_not_woken_if_expired(self, timer):
        timer.is_expired.return_value = True
        assert SleepManager(timer).auto_sleep_and_wake().woken is False

    def test_returns_wake_message(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text(json.dumps(msg_notif("t1", "hello")))
        with patch("session.set_status"), patch("session.log"):
            result = mgr.auto_sleep_and_wake()
        assert result.woken and "hello" in result.wake_message

    def test_acks_slack_on_slack_notification(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text(json.dumps(
            [{"type": "slack", "source": "slack", "channels": [{"id": "C1", "unread": 1}]}]
        ))
        with patch("session.set_status"), patch("session.log"), \
             patch.object(mgr, "_ack_slack") as ack:
            mgr.auto_sleep_and_wake()
        ack.assert_called_once()

    def test_no_ack_for_non_slack(self, timer, cache_file):
        mgr = SleepManager(timer)
        cache_file.write_text(json.dumps(msg_notif()))
        with patch("session.set_status"), patch("session.log"), \
             patch.object(mgr, "_ack_slack") as ack:
            mgr.auto_sleep_and_wake()
        ack.assert_not_called()


def _cr(**kw):
    from process import ClaudeResult
    return ClaudeResult(**{**dict(exit_code=0, hung=False, timed_out=False,
                                  no_output=False, incomplete=False, context_pct=0.0), **kw})


class TestRunWakeCycle:
    def test_returns_none_when_not_woken(self, timer):
        mgr = SleepManager(timer)
        with patch.object(mgr, "auto_sleep_and_wake", return_value=SleepResult(woken=False)), \
             patch("session.log"):
            assert mgr.run_wake_cycle(MagicMock()) is None

    def test_returns_claude_result_on_context_fill(self, timer):
        mgr = SleepManager(timer)
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.return_value = _cr(context_pct=90.0)
        with patch.object(mgr, "auto_sleep_and_wake", return_value=SleepResult(woken=True, wake_message="ping")), \
             patch("session.log"), patch("session.time.sleep"):
            result = mgr.run_wake_cycle(claude)
        assert result is not None and result.context_pct == 90.0

    def test_retries_hung_wake_then_succeeds(self, timer):
        mgr = SleepManager(timer)
        claude = MagicMock()
        claude.resume.return_value = 0
        claude.monitor.side_effect = [_cr(hung=True), _cr(exit_code=0)]
        wakes = [SleepResult(woken=True, wake_message="ping"), SleepResult(woken=False)]
        with patch.object(mgr, "auto_sleep_and_wake", side_effect=wakes), \
             patch("session.log"), patch("session.time.sleep"):
            mgr.run_wake_cycle(claude)
        assert claude.monitor.call_count == 2
