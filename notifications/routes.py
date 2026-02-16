"""Relaygent Notifications — notification aggregation and health routes."""

import json
import os
import urllib.request
from datetime import datetime, timedelta

from config import app
from db import get_db
from flask import jsonify, request
from reminders import is_recurring_reminder_due

HUB_HOST = os.environ.get("RELAYGENT_HUB_HOST", "127.0.0.1")
HUB_PORT = os.environ.get("RELAYGENT_HUB_PORT", "8080")


@app.route("/notifications/pending", methods=["GET"])
def get_notifications():
    """Unified endpoint: return all pending notifications."""
    notifications = []
    _collect_due_reminders(notifications)
    _collect_chat_messages(notifications)
    return jsonify(notifications)


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
        pass


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})
