"""JSONL session file inspection utilities for the relay harness.

These functions read Claude's session JSONL files to detect:
- Incomplete exits (Claude crashed mid-conversation)
- Whether Claude finished communicating (for sleep decisions)
- Context window fill percentage
"""

from __future__ import annotations

import json
from pathlib import Path

from config import CONTEXT_WINDOW, log


def find_jsonl_path(session_id: str, workspace: Path) -> Path | None:
    """Find the jsonl file for a session."""
    claude_dir = Path.home() / ".claude" / "projects"
    workspace_slug = str(workspace).replace("/", "-")
    project_dir = claude_dir / workspace_slug
    if project_dir.exists():
        jsonl = project_dir / f"{session_id}.jsonl"
        if jsonl.exists():
            return jsonl
    return None


def get_jsonl_size(session_id: str, workspace: Path) -> int:
    """Get current size of session jsonl file."""
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl or not jsonl.exists():
        return 0
    try:
        return jsonl.stat().st_size
    except OSError:
        return 0


def _read_tail(jsonl: Path, bytes_count: int = 16384) -> list[str]:
    """Read last N bytes of a JSONL file and return lines."""
    try:
        with open(jsonl, 'rb') as f:
            f.seek(0, 2)
            size = f.tell()
            if size == 0:
                return []
            f.seek(max(0, size - bytes_count))
            return f.read().decode('utf-8', errors='ignore').strip().split('\n')
    except OSError:
        return []


def check_incomplete_exit(session_id: str, workspace: Path) -> tuple[bool, str]:
    """Check if Claude exited mid-conversation. Returns (incomplete, last_tool)."""
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl:
        return False, ""
    try:
        lines = _read_tail(jsonl)
        if not lines:
            return False, ""

        last_entry = json.loads(lines[-1])
        if last_entry.get("type") == "user":
            content = last_entry.get("message", {}).get("content", [])
            if content and isinstance(content, list):
                for item in content:
                    if item.get("type") == "tool_result":
                        return True, item.get("tool_use_id", "unknown tool")
            return True, ""
        return False, ""
    except (OSError, json.JSONDecodeError, KeyError):
        return False, ""


def should_sleep(session_id: str, workspace: Path) -> bool:
    """Check if Claude finished communicating before exiting.

    Only return True if Claude wrote text output (not just tool calls).
    This prevents sleeping when Claude crashes/exits mid-conversation.
    """
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl or not jsonl.exists():
        log("Should sleep? No - JSONL not found")
        return False

    try:
        lines = _read_tail(jsonl)
        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                if entry.get("type") == "assistant":
                    content = entry.get("message", {}).get("content", [])
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get("type") == "text":
                                log("Should sleep? Yes - Claude wrote text output")
                                return True
                    log("Should sleep? No - last assistant message has no text")
                    return False
                if entry.get("type") == "user":
                    log("Should sleep? No - last message is tool result")
                    return False
            except json.JSONDecodeError:
                continue
        return False
    except Exception:
        return False


def get_context_fill_from_jsonl(session_id: str, workspace: Path) -> float:
    """Get context fill percentage by parsing JSONL usage data."""
    jsonl = find_jsonl_path(session_id, workspace)
    if not jsonl or not jsonl.exists():
        return 0.0
    try:
        lines = _read_tail(jsonl, 8192)
        for line in reversed(lines):
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                if entry.get("type") == "assistant":
                    usage = entry.get("message", {}).get("usage", {})
                    if usage:
                        total = (usage.get("input_tokens", 0)
                                + usage.get("output_tokens", 0)
                                + usage.get("cache_creation_input_tokens", 0)
                                + usage.get("cache_read_input_tokens", 0))
                        return total / CONTEXT_WINDOW * 100
            except json.JSONDecodeError:
                continue
        return 0.0
    except Exception:
        return 0.0
