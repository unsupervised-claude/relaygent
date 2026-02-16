"""Notification formatting for wake messages."""

from __future__ import annotations

def format_chat(notifs: list) -> list[str]:
    """Format chat notification messages. Chat is owner-only — no sandboxing."""
    parts = []
    for msg in notifs:
        actual = msg.get("messages", [])
        if actual:
            lines = [m.get("content", "") for m in actual]
            parts.append("\n".join(lines))
        else:
            parts.append("New chat message (check unread to view)")
    return parts


def format_reminders(notifs: list) -> list[str]:
    """Format reminder notifications."""
    parts = []
    for r in notifs:
        parts.append(f"\u23f0 REMINDER (ID {r.get('id', '?')}):\n\n{r.get('message', '(no message)')}")
    return parts


def format_notifications(notifications: list) -> str:
    """Format all notifications into a single wake message."""
    by_type = {}
    for n in notifications:
        t = n.get("type", "unknown")
        by_type.setdefault(t, []).append(n)

    parts = []
    parts.extend(format_chat(by_type.get("message", [])))
    parts.extend(format_reminders(by_type.get("reminder", [])))

    return "\n\n---\n\n".join(parts)
