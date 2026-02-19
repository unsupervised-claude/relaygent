"""Sleep/wake handling using cached notifications file.

Reads the background notification-poller cache instead of hitting the
Slack/email APIs directly (avoids hammering APIs every second).
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime

from config import (
    CONTEXT_THRESHOLD, INCOMPLETE_BASE_DELAY, MAX_INCOMPLETE_RETRIES,
    SLEEP_POLL_INTERVAL, Timer, log, set_status,
)
from notify_format import format_notifications

NOTIFICATIONS_PORT = os.environ.get("RELAYGENT_NOTIFICATIONS_PORT", "8083")
NOTIFICATIONS_CACHE = "/tmp/relaygent-notifications-cache.json"


@dataclass
class SleepResult:
    """Result of sleep/wake cycle."""
    woken: bool
    wake_message: str = ""


MAX_CACHE_STALE = 60  # Force wake if cache file hasn't updated in this many seconds


class SleepManager:
    """Handles sleep polling using cached notification file."""

    def __init__(self, timer: Timer):
        self.timer = timer
        self._seen_timestamps = set()
        self._cache_missing_since: float | None = None

    def _check_notifications(self) -> list:
        """Read cached notifications file. Returns list of NEW pending notifications."""
        try:
            with open(NOTIFICATIONS_CACHE) as f:
                notifications = json.loads(f.read())
        except (FileNotFoundError, json.JSONDecodeError):
            return []

        new_notifications = []
        for notif in notifications:
            notif_timestamps = self._extract_timestamps(notif)
            new_timestamps = notif_timestamps - self._seen_timestamps
            if new_timestamps:
                self._seen_timestamps.update(notif_timestamps)
                new_notifications.append(notif)

        return new_notifications

    def _extract_timestamps(self, notif: dict) -> set:
        """Extract dedup keys from a notification."""
        timestamps = set()
        for msg in notif.get("messages", []):
            ts = msg.get("timestamp")
            if ts:
                timestamps.add(ts)

        if notif.get("type") == "reminder":
            timestamps.add(f"reminder-{notif.get('id')}")

        # Slack/email: include count in dedup key so new messages
        # in the same channel still trigger a wake
        source = notif.get("source", "")
        for ch in notif.get("channels", []):
            timestamps.add(f"{source}-{ch.get('id', '')}-{ch.get('unread', 0)}")

        # Fallback: if no dedup keys found, use type+source as key
        if not timestamps and notif.get("type"):
            timestamps.add(f"{notif['type']}-{source}-{notif.get('count', 0)}")

        return timestamps

    def _ack_slack(self) -> None:
        """Tell notifications server to advance Slack read marker."""
        try:
            ack_url = f"http://127.0.0.1:{NOTIFICATIONS_PORT}/notifications/ack-slack"
            req = urllib.request.Request(ack_url, method="POST", data=b"")
            urllib.request.urlopen(req, timeout=3)
        except (urllib.error.URLError, OSError):
            pass  # Best-effort

    def _wait_for_wake(self) -> tuple[bool, list]:
        """Poll cache file for wake condition. Returns (woken, notifications)."""
        # Slack dedup keys include unread count, so new messages produce new keys.
        # Don't clear them here — causes infinite wake loop on channels with phantom unreads.
        set_status("sleeping")
        log("Sleeping, waiting for notifications...")

        while True:
            notifications = self._check_notifications()
            if notifications:
                first = notifications[0]
                log(f"Notification: {first.get('type', '?')}")
                return True, notifications

            # Force-wake if cache file is stale or missing (poller may have died)
            try:
                age = time.time() - os.path.getmtime(NOTIFICATIONS_CACHE)
                self._cache_missing_since = None
                if age > MAX_CACHE_STALE:
                    log(f"Notification cache stale ({int(age)}s), force-waking")
                    return True, [{"type": "system", "message":
                        "Notification cache stale — waking to check status."}]
            except OSError:
                if self._cache_missing_since is None:
                    self._cache_missing_since = time.time()
                elif time.time() - self._cache_missing_since > MAX_CACHE_STALE:
                    log("Notification cache missing, force-waking")
                    self._cache_missing_since = None
                    return True, [{"type": "system", "message":
                        "Notification cache missing — poller may not be running."}]

            if self.timer.is_expired():
                log("Out of time")
                return False, []

            time.sleep(SLEEP_POLL_INTERVAL)

    def auto_sleep_and_wake(self) -> SleepResult:
        """Auto-sleep waiting for any notification. Returns SleepResult."""
        if self.timer.is_expired():
            return SleepResult(woken=False)

        woken, notifications = self._wait_for_wake()
        if not woken:
            return SleepResult(woken=False)

        # Ack Slack notifications so they don't re-trigger on next sleep
        if any(n.get("source") == "slack" for n in notifications):
            self._ack_slack()

        wake_message = format_notifications(notifications)
        current_time = datetime.now().strftime("%H:%M:%S %Z")
        wake_message += f"\n\nCurrent time: {current_time}"

        set_status("working")
        log("Waking agent...")
        return SleepResult(woken=True, wake_message=wake_message)

    def run_wake_cycle(self, claude):
        """Sleep/wake loop with retry limits. Returns ClaudeResult if context-full."""
        while True:
            result = self.auto_sleep_and_wake()
            if not result or not result.woken:
                return None
            time.sleep(3)
            try:
                log_start = claude.resume(result.wake_message)
            except OSError as e:
                log(f"Resume failed on wake: {e}, retrying...")
                time.sleep(5)
                continue
            claude_result = claude.monitor(log_start)
            if claude_result.timed_out:
                return None
            wake_retries = 0
            while claude_result.incomplete or claude_result.hung or claude_result.no_output:
                if self.timer.is_expired():
                    return None
                wake_retries += 1
                if wake_retries > MAX_INCOMPLETE_RETRIES:
                    log(f"Too many wake retries ({wake_retries}), giving up on this wake cycle")
                    break
                delay = min(INCOMPLETE_BASE_DELAY * (2 ** (wake_retries - 1)), 60)
                kind, resume_msg = (
                    ("Hung", "An API error was detected. Continue where you left off.")
                    if claude_result.hung else
                    ("Incomplete", "Continue where you left off.")
                    if claude_result.incomplete else
                    ("No output", "Your wake session exited without output. Continue where you left off.")
                )
                log(f"{kind} during wake ({wake_retries}/{MAX_INCOMPLETE_RETRIES}), resuming in {delay}s...")
                time.sleep(delay)
                log_start = claude.resume(resume_msg)
                claude_result = claude.monitor(log_start)
                if claude_result.timed_out:
                    return None
            if claude_result.context_too_large:
                log("Request too large or bad image during wake — returning for fresh session")
                return claude_result
            if claude_result.exit_code != 0:
                log(f"Crashed during wake (exit={claude_result.exit_code}), resuming...")
                time.sleep(3)
                log_start = claude.resume("You crashed and were resumed. Continue where you left off.")
                claude_result = claude.monitor(log_start)
            if claude_result.context_pct >= CONTEXT_THRESHOLD:
                return claude_result
