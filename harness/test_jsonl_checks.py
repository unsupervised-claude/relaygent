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
    find_jsonl_path,
    get_jsonl_size,
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
        lines = [json.dumps({"i": i, "pad": "x" * 100}) for i in range(1000)]
        f.write_text("\n".join(lines) + "\n")
        result = _read_tail(f, bytes_count=512)
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


# --- find_jsonl_path ---


class TestFindJsonlPath:
    def test_path_with_dots(self, tmp_path):
        """Workspace paths with dots must slug correctly (dots → dashes)."""
        session_id = "test-session-dots"
        workspace = tmp_path / "user.name" / "my.project"
        workspace.mkdir(parents=True)
        slug = str(workspace).replace("/", "-").replace(".", "-")
        project_dir = tmp_path / ".claude" / "projects" / slug
        project_dir.mkdir(parents=True)
        jsonl_path = project_dir / f"{session_id}.jsonl"
        jsonl_path.write_text('{"type": "assistant"}\n')

        with patch("jsonl_checks.Path.home", return_value=tmp_path):
            result = find_jsonl_path(session_id, workspace)
        assert result == jsonl_path


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
        assert not incomplete
