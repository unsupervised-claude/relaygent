"""Tests for context fill calculation from JSONL session files."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from jsonl_checks import get_context_fill_from_jsonl


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


class TestGetContextFill:
    def test_calculates_fill_percentage(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {
                "content": [{"type": "text", "text": "hi"}],
                "usage": {
                    "input_tokens": 100000, "output_tokens": 50000,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                },
            }},
        ])
        fill = get_context_fill_from_jsonl(sid, ws)
        assert fill == 75.0  # 150000 / 200000 * 100

    def test_includes_cache_tokens(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {
                "content": [{"type": "text", "text": "hi"}],
                "usage": {
                    "input_tokens": 50000, "output_tokens": 50000,
                    "cache_creation_input_tokens": 30000,
                    "cache_read_input_tokens": 20000,
                },
            }},
        ])
        fill = get_context_fill_from_jsonl(sid, ws)
        assert fill == 75.0  # 150000 / 200000 * 100

    def test_returns_zero_for_missing_file(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        assert get_context_fill_from_jsonl("no-session", ws) == 0.0

    def test_returns_zero_for_no_usage_data(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {
                "content": [{"type": "text", "text": "hi"}],
            }},
        ])
        assert get_context_fill_from_jsonl(sid, ws) == 0.0

    def test_uses_last_assistant_message(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        write([
            {"type": "assistant", "message": {
                "content": [{"type": "text", "text": "first"}],
                "usage": {"input_tokens": 10000, "output_tokens": 10000,
                          "cache_creation_input_tokens": 0,
                          "cache_read_input_tokens": 0},
            }},
            {"type": "user", "message": {"content": "next"}},
            {"type": "assistant", "message": {
                "content": [{"type": "text", "text": "second"}],
                "usage": {"input_tokens": 160000, "output_tokens": 10000,
                          "cache_creation_input_tokens": 0,
                          "cache_read_input_tokens": 0},
            }},
        ])
        fill = get_context_fill_from_jsonl(sid, ws)
        assert fill == 85.0  # 170000 / 200000 * 100

    def test_skips_malformed_lines(self, tmp_jsonl):
        sid, ws, path, write = tmp_jsonl
        path.write_text(
            json.dumps({"type": "assistant", "message": {
                "content": [{"type": "text", "text": "hi"}],
                "usage": {"input_tokens": 100000, "output_tokens": 0,
                          "cache_creation_input_tokens": 0,
                          "cache_read_input_tokens": 0},
            }}) + "\n"
            + "THIS IS NOT JSON\n"
        )
        fill = get_context_fill_from_jsonl(sid, ws)
        assert fill == 50.0  # Skips bad line, finds valid one
