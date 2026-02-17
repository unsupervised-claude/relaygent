"""Relaygent Notifications — notification aggregation and health routes."""

import json
import logging
import os
import urllib.request
from datetime import datetime, timedelta

from config import app
from db import get_db
from flask import jsonify, request
from reminders import is_recurring_reminder_due

logger = logging.getLogger(__name__)

HUB_HOST = os.environ.get("RELAYGENT_HUB_HOST", "127.0.0.1")
HUB_PORT = os.environ.get("RELAYGENT_HUB_PORT", "8080")
SLACK_TOKEN_PATH = os.path.join(
    os.path.expanduser("~"), ".relaygent", "slack", "token.json"
)


@app.route("/notifications/pending", methods=["GET"])
def get_notifications():
    """Unified endpoint: return all pending notifications.

    Query params:
        fast=1 — only check fast local sources (DB reminders + hub chat).
                 Skips slow external APIs (Slack, email). Used by the
                 notification-poller daemon which polls every 1s.
    """
    fast_mode = request.args.get("fast") == "1"
    notifications = []
    try:
        _collect_due_reminders(notifications)
    except Exception:
        logger.exception("Failed to collect due reminders")
    try:
        _collect_chat_messages(notifications)
    except Exception:
        logger.exception("Failed to collect chat messages")
    if not fast_mode:
        for collector in _slow_collectors:
            try:
                collector(notifications)
            except Exception:
                logger.exception(f"Failed in {collector.__name__}")
    return jsonify(notifications)


# Slow collectors — external API calls, skipped in fast mode.
# Append functions here (e.g., Slack, email) as integrations are added.
_slow_collectors = []


def _collect_due_reminders(notifications):
    """Add due reminders (one-off and recurring) to notifications list."""
    now = datetime.now()
    now_iso = now.isoformat()
    stale_cutoff = (now - timedelta(hours=1)).isoformat()

    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, trigger_time, message, created_at, recurrence "
            "FROM reminders WHERE fired = 0 ORDER BY trigger_time"
        ).fetchall()

        for r in rows:
            if r["recurrence"]:
                is_due, prev_occ = is_recurring_reminder_due(
                    r["recurrence"], r["trigger_time"]
                )
                if is_due:
                    conn.execute(
                        "UPDATE reminders SET trigger_time = ? WHERE id = ?",
                        (prev_occ, r["id"]),
                    )
                    conn.commit()
                    notifications.append({
                        "type": "reminder",
                        "id": r["id"],
                        "message": r["message"],
                        "trigger_time": prev_occ,
                        "created_at": r["created_at"],
                    })
            elif r["trigger_time"] <= now_iso:
                conn.execute(
                    "UPDATE reminders SET fired = 1 WHERE id = ?",
                    (r["id"],),
                )
                conn.commit()
                if r["trigger_time"] >= stale_cutoff:
                    notifications.append({
                        "type": "reminder",
                        "id": r["id"],
                        "message": r["message"],
                        "trigger_time": r["trigger_time"],
                        "created_at": r["created_at"],
                    })


def _collect_chat_messages(notifications):
    """Check hub chat for unread messages."""
    try:
        url = f"http://{HUB_HOST}:{HUB_PORT}/api/chat?mode=unread"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode())
        if data.get("count", 0) > 0:
            messages = []
            for m in data.get("messages", []):
                messages.append({
                    "timestamp": m.get("created_at", ""),
                    "content": m.get("content", ""),
                })
            notifications.append({
                "type": "message",
                "source": "chat",
                "count": data["count"],
                "messages": messages,
            })
    except Exception:
        logger.warning("Failed to check hub chat for unread messages", exc_info=True)


def _collect_slack_messages(notifications):
    """Check Slack for unread DMs and mentions."""
    if not os.path.exists(SLACK_TOKEN_PATH):
        return
    try:
        with open(SLACK_TOKEN_PATH) as f:
            token = json.loads(f.read()).get("access_token")
    except (json.JSONDecodeError, OSError):
        return
    if not token:
        return
    data = json.dumps(
        {"limit": 200, "types": "im,mpim", "exclude_archived": True}
    ).encode()
    req = urllib.request.Request(
        "https://slack.com/api/conversations.list",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        result = json.loads(resp.read().decode())
    if not result.get("ok"):
        return
    unread = [
        c for c in (result.get("channels") or [])
        if (c.get("unread_count_display") or 0) > 0
    ]
    if not unread:
        return
    total = sum(c.get("unread_count_display", 0) for c in unread)
    channels = [
        {"id": c["id"], "name": c.get("name", c["id"]),
         "unread": c.get("unread_count_display", 0)}
        for c in unread
    ]
    notifications.append({
        "type": "message",
        "source": "slack",
        "count": total,
        "channels": channels,
    })


_slow_collectors.append(_collect_slack_messages)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})
