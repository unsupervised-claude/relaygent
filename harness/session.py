"""Sleep/wake handling using unified notifications endpoint."""

from __future__ import annotations

import json
import os
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime

from config import SLEEP_POLL_INTERVAL, Timer, log, set_status
from notify_format import format_notifications

NOTIFICATIONS_PORT = os.environ.get("RELAYGENT_NOTIFICATIONS_PORT", "8083")
NOTIFICATIONS_API = f"http://127.0.0.1:{NOTIFICATIONS_PORT}/notifications/pending"


@dataclass
class SleepResult:
    """Result of sleep/wake cycle."""
    woken: bool
    wake_message: str = ""


class SleepManager:
    """Handles sleep polling using unified notification service."""

    def __init__(self, timer: Timer):
        self.timer = timer
        self._seen_timestamps = set()

    def _check_notifications(self) -> list:
        """Check unified notifications endpoint. Returns list of NEW pending notifications."""
        try:
            req = urllib.request.Request(NOTIFICATIONS_API, method="GET")
            with urllib.request.urlopen(req, timeout=10) as resp:
                notifications = json.loads(resp.read().decode())
        except Exception:
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
        return timestamps

    def _wait_for_wake(self) -> tuple[bool, list]:
        """Poll for wake condition. Returns (woken, notifications)."""
        set_status("sleeping")
        log("Sleeping, waiting for notifications...")

        while True:
            notifications = self._check_notifications()
            if notifications:
                first = notifications[0]
                log(f"Notification: {first.get('type', '?')}")
                return True, notifications

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

        wake_message = format_notifications(notifications)
        current_time = datetime.now().strftime("%H:%M:%S %Z")
        wake_message += f"\n\nCurrent time: {current_time}"

        set_status("working")
        log("Waking agent...")
        return SleepResult(woken=True, wake_message=wake_message)
