"""Tests for JSONL session file inspection utilities."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Allow imports from harness directory
sys.path.insert(0, str(Path(__file__).parent))

from jsonl_checks import (
    _read_tail,
    check_incomplete_exit,
    get_jsonl_size,
    should_sleep,
)


@pytest.fixture
def tmp_jsonl(tmp_path):
    """Helper to create a fake JSONL session file in the expected location."""
    session_id = "test-session-abc"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    slug = str(workspace).replace("/", "-")
    project_dir = tmp_path / ".claude" / "projects" / slug
    project_dir.mkdir(parents=True)
    jsonl_path = project_dir / f"{session_id}.jsonl"

    def write_entries(entries: list[dict]):
        jsonl_path.write_text(
            "\n".join(json.dumps(e) for e in entries) + "\n"
        )

    with patch("jsonl_checks.Path.home", return_value=tmp_path):
        yield session_id, workspace, jsonl_path, write_entries


# --- _read_tail ---


class TestReadTail:
    def test_empty_file(self, tmp_path):
        f = tmp_path / "empty.jsonl"
        f.write_text("")
        assert _read_tail(f) == []

    def test_single_line(self, tmp_path):
        f = tmp_path / "one.jsonl"
        f.write_text('{"type": "assistant"}\n')
        lines = _read_tail(f)
        assert len(lines) == 1
        assert json.loads(lines[0])["type"] == "assistant"

    def test_skips_partial_first_line_on_seek(self, tmp_path):
        f = tmp_path / "big.jsonl"
        # Write enough data that seeking skips the first line
        lines = [json.dumps({"i": i, "pad": "x" * 100}) for i in range(1000)]
        f.write_text("\n".join(lines) + "\n")
        result = _read_tail(f, bytes_count=512)
        # All returned lines should be valid JSON
        for line in result:
            parsed = json.loads(line)
            assert "i" in parsed

    def test_handles_utf8_gracefully(self, tmp_path):
        f = tmp_path / "utf8.jsonl"
        f.write_text('{"text": "héllo wörld 日本語"}\n')
        lines = _read_tail(f)
        assert len(lines) == 1
        parsed = json.loads(lines[0])
        assert "héllo" in parsed["text"]

    def test_nonexistent_file(self, tmp_path):
        f = tmp_path / "missing.jsonl"
        assert _read_tail(f) == []


# --- get_jsonl_size ---


class TestGetJsonlSize:
    def test_returns_size(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([{"type": "assistant", "message": {"content": [{"type": "text", "text": "hi"}]}}])
        size = get_jsonl_size(sid, ws)
        assert size > 0
        assert size == path.stat().st_size

    def test_missing_session(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        assert get_jsonl_size("nonexistent-id", ws) == 0


# --- check_incomplete_exit ---


class TestCheckIncompleteExit:
    def test_clean_exit_assistant_last(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {"content": [{"type": "text", "text": "Done."}]}},
        ])
        incomplete, tool = check_incomplete_exit(sid, ws)
        assert not incomplete
        assert tool == ""

    def test_incomplete_tool_result_pending(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "user", "message": {"content": [
                {"type": "tool_result", "tool_use_id": "tu_abc123"}
            ]}},
        ])
        incomplete, tool = check_incomplete_exit(sid, ws)
        assert incomplete
        assert tool == "tu_abc123"

    def test_incomplete_user_message_no_tool(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "user", "message": {"content": "just text"}},
        ])
        incomplete, tool = check_incomplete_exit(sid, ws)
        assert incomplete
        assert tool == ""

    def test_no_jsonl_file(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        incomplete, tool = check_incomplete_exit("no-such-session", ws)
        assert not incomplete

    def test_empty_file(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        path.write_text("")
        incomplete, tool = check_incomplete_exit(sid, ws)
        assert not incomplete

    def test_malformed_json(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        path.write_text("not valid json\n")
        incomplete, tool = check_incomplete_exit(sid, ws)
        assert not incomplete  # Gracefully handles parse errors


# --- should_sleep ---


class TestShouldSleep:
    def test_sleeps_after_text_output(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {"content": [
                {"type": "text", "text": "All done, going to sleep."}
            ]}},
        ])
        assert should_sleep(sid, ws) is True

    def test_no_sleep_if_last_is_tool_result(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "user", "message": {"content": [
                {"type": "tool_result", "tool_use_id": "tu_xyz"}
            ]}},
        ])
        assert should_sleep(sid, ws) is False

    def test_no_sleep_if_only_tool_use(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "tu_1", "name": "Read", "input": {}}
            ]}},
        ])
        assert should_sleep(sid, ws) is False

    def test_no_sleep_if_no_file(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        assert should_sleep("missing-session", ws) is False

    def test_sleeps_with_mixed_content(self, tmp_jsonl):
        """If last assistant has both tool_use and text, should sleep."""
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "tu_1", "name": "Bash", "input": {}},
                {"type": "text", "text": "Done with that task."},
            ]}},
        ])
        assert should_sleep(sid, ws) is True
