"""Relaygent Notifications — reminder CRUD routes and recurring logic."""

from datetime import datetime

from config import CRONITER_AVAILABLE, app
from db import get_db
from flask import jsonify, request

if CRONITER_AVAILABLE:
    from croniter import croniter


@app.route("/pending", methods=["GET"])
def get_pending():
    """Return all pending (unfired) reminders that are due."""
    now = datetime.now().isoformat()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, trigger_time, message, created_at, recurrence "
            "FROM reminders WHERE fired = 0 AND trigger_time <= ? "
            "ORDER BY trigger_time",
            (now,),
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/upcoming", methods=["GET"])
def get_upcoming():
    """Return all unfired reminders (due or not)."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, trigger_time, message, created_at, recurrence "
            "FROM reminders WHERE fired = 0 ORDER BY trigger_time"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/reminder", methods=["POST"])
def create_reminder():
    """Create a new reminder. JSON: {trigger_time, message, recurrence?}"""
    data = request.get_json()
    if not data or "trigger_time" not in data or "message" not in data:
        return jsonify({"error": "trigger_time and message required"}), 400

    try:
        datetime.fromisoformat(data["trigger_time"])
    except (ValueError, TypeError):
        return jsonify({"error": "trigger_time must be valid ISO format"}), 400

    if not data["message"].strip():
        return jsonify({"error": "message must not be empty"}), 400

    recurrence = data.get("recurrence")
    if recurrence and not CRONITER_AVAILABLE:
        return jsonify({"error": "recurring reminders require croniter (pip install croniter)"}), 400
    if recurrence and CRONITER_AVAILABLE:
        try:
            croniter(recurrence)
        except (ValueError, KeyError):
            return jsonify({"error": "invalid cron expression"}), 400

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO reminders (trigger_time, message, recurrence) "
            "VALUES (?, ?, ?)",
            (data["trigger_time"], data["message"], recurrence),
        )
        conn.commit()
        reminder_id = cursor.lastrowid

    result = {"id": reminder_id, "status": "created"}
    if recurrence:
        result["recurrence"] = recurrence
    return jsonify(result), 201


@app.route("/reminder/<int:reminder_id>", methods=["DELETE"])
def delete_reminder(reminder_id):
    """Delete/cancel a reminder."""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM reminders WHERE id = ?", (reminder_id,)
        )
        conn.commit()
    return jsonify({"status": "deleted"})


@app.route("/reminder/<int:reminder_id>/fire", methods=["POST"])
def fire_reminder(reminder_id):
    """Mark a reminder as fired. Recurring reminders get rescheduled."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT recurrence, trigger_time FROM reminders WHERE id = ?",
            (reminder_id,),
        ).fetchone()

        if row and row["recurrence"] and CRONITER_AVAILABLE:
            cron = croniter(row["recurrence"], datetime.now())
            next_time = cron.get_next(datetime).isoformat()
            conn.execute(
                "UPDATE reminders SET trigger_time = ? WHERE id = ?",
                (next_time, reminder_id),
            )
            conn.commit()
            return jsonify({
                "status": "rescheduled", "next_trigger": next_time,
            })
        conn.execute(
            "UPDATE reminders SET fired = 1 WHERE id = ?",
            (reminder_id,),
        )
        conn.commit()
        return jsonify({"status": "fired"})


def is_recurring_reminder_due(recurrence, last_trigger_time, window_minutes=5):
    """Check if recurring reminder should fire now.

    Returns (is_due, prev_occurrence_iso).
    """
    if not CRONITER_AVAILABLE:
        return False, ""

    now = datetime.now()
    cron = croniter(recurrence, now)
    prev_occurrence = cron.get_prev(datetime)

    minutes_since = (now - prev_occurrence).total_seconds() / 60
    if minutes_since > window_minutes:
        return False, ""

    if last_trigger_time:
        last_trigger_dt = datetime.fromisoformat(last_trigger_time)
        if last_trigger_dt >= prev_occurrence:
            return False, ""

    return True, prev_occurrence.isoformat()
