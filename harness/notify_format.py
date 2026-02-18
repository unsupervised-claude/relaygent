"""Notification formatting for wake messages."""

from __future__ import annotations

def _format_slack_channel(ch: dict) -> str:
    """Format a single Slack channel with its message previews."""
    name = ch.get("name", ch.get("id", "?"))
    lines = [f"#{name}:"]
    for m in ch.get("messages", []):
        user = m.get("user", "?")
        text = m.get("text", "").strip()
        if text:
            lines.append(f"  <@{user}>: {text}")
    if not ch.get("messages"):
        lines.append(f"  ({ch.get('unread', 0)} new message(s))")
    return "\n".join(lines)


def format_chat(notifs: list) -> list[str]:
    """Format chat and Slack notification messages."""
    parts = []
    for msg in notifs:
        source = msg.get("source", "chat")
        if source == "slack":
            channels = msg.get("channels", [])
            ch_parts = [_format_slack_channel(c) for c in channels]
            parts.append("New Slack messages:\n" + "\n\n".join(ch_parts))
        elif msg.get("messages"):
            lines = [m.get("content", "") for m in msg["messages"]]
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


def format_unknown(notifs: list) -> list[str]:
    """Format unrecognized notification types."""
    parts = []
    for n in notifs:
        ntype = n.get("type", "unknown")
        msg = n.get("message", n.get("content", str(n)))
        parts.append(f"[{ntype}] {msg}")
    return parts


FORMATTERS = {
    "message": format_chat,
    "reminder": format_reminders,
}


def format_notifications(notifications: list) -> str:
    """Format all notifications into a single wake message."""
    by_type: dict[str, list] = {}
    for n in notifications:
        t = n.get("type", "unknown")
        by_type.setdefault(t, []).append(n)

    parts = []
    for ntype, notifs in by_type.items():
        formatter = FORMATTERS.get(ntype, format_unknown)
        parts.extend(formatter(notifs))

    return "\n\n---\n\n".join(parts)
