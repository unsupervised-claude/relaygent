"""Tests for notification formatting."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from notify_format import format_chat, format_notifications, format_reminders, format_unknown


class TestFormatChat:
    def test_formats_message_content(self):
        notifs = [{"messages": [{"content": "Hello from Preston"}]}]
        result = format_chat(notifs)
        assert result == ["Hello from Preston"]

    def test_multiple_messages(self):
        notifs = [{"messages": [
            {"content": "Line 1"},
            {"content": "Line 2"},
        ]}]
        result = format_chat(notifs)
        assert result == ["Line 1\nLine 2"]

    def test_empty_messages(self):
        notifs = [{"messages": []}]
        result = format_chat(notifs)
        assert "check unread" in result[0].lower()

    def test_missing_messages_key(self):
        notifs = [{}]
        result = format_chat(notifs)
        assert "check unread" in result[0].lower()


class TestFormatReminders:
    def test_formats_reminder(self):
        notifs = [{"id": 42, "message": "Check the build"}]
        result = format_reminders(notifs)
        assert len(result) == 1
        assert "42" in result[0]
        assert "Check the build" in result[0]

    def test_missing_fields(self):
        notifs = [{}]
        result = format_reminders(notifs)
        assert "?" in result[0]
        assert "no message" in result[0]


class TestFormatUnknown:
    def test_formats_unknown_type(self):
        notifs = [{"type": "email", "message": "New email from Alice"}]
        result = format_unknown(notifs)
        assert "[email]" in result[0]
        assert "Alice" in result[0]

    def test_fallback_to_content(self):
        notifs = [{"type": "sms", "content": "Hey there"}]
        result = format_unknown(notifs)
        assert "Hey there" in result[0]

    def test_fallback_to_str(self):
        notifs = [{"type": "weird"}]
        result = format_unknown(notifs)
        assert "weird" in result[0]


class TestFormatNotifications:
    def test_single_chat(self):
        notifs = [{"type": "message", "messages": [{"content": "Hi"}]}]
        result = format_notifications(notifs)
        assert "Hi" in result

    def test_single_reminder(self):
        notifs = [{"type": "reminder", "id": 1, "message": "Do the thing"}]
        result = format_notifications(notifs)
        assert "Do the thing" in result

    def test_mixed_types(self):
        notifs = [
            {"type": "message", "messages": [{"content": "Hello"}]},
            {"type": "reminder", "id": 5, "message": "Check PR"},
        ]
        result = format_notifications(notifs)
        assert "Hello" in result
        assert "Check PR" in result
        assert "---" in result  # Separator between types

    def test_empty_notifications(self):
        result = format_notifications([])
        assert result == ""

    def test_unknown_type_uses_fallback(self):
        notifs = [{"type": "signal", "message": "New signal msg"}]
        result = format_notifications(notifs)
        assert "[signal]" in result
