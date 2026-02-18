"""Tests for should_sleep() in JSONL session file inspection utilities."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from jsonl_checks import should_sleep


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
