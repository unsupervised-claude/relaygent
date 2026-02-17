"""Relaygent configuration and constants."""

import os
import shutil
import time
from datetime import datetime
from pathlib import Path

# Timing constants
SLEEP_POLL_INTERVAL = 1         # Local file check frequency while sleeping
HANG_CHECK_DELAY = 90           # Seconds before checking for hang patterns
SILENCE_TIMEOUT = 300           # Seconds of no output before considering hung
MAX_RETRIES = 2                 # 3 total attempts
MAX_INCOMPLETE_RETRIES = 5      # Start fresh after 5 consecutive incomplete exits
INCOMPLETE_BASE_DELAY = 5       # Base delay for incomplete exit backoff (seconds)
CONTEXT_THRESHOLD = 85          # % context fill to trigger wrap-up warning
MIN_SUCCESSOR_TIME = 10 * 60    # Don't spawn successor with <10 min remaining
CONTEXT_WINDOW = 200000         # Opus 4.6 context window size

# Log settings
LOG_MAX_SIZE = 512000           # 500KB
LOG_TRUNCATE_SIZE = 204800      # 200KB

# Paths
SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_DIR = SCRIPT_DIR.parent
LOG_FILE = REPO_DIR / "logs" / "relaygent.log"
PROMPT_FILE = SCRIPT_DIR / "prompt.md"
RUNS_DIR = SCRIPT_DIR / "runs"


def log(msg: str) -> None:
    """Print timestamped log message."""
    timestamp = time.strftime("%a %b %d %H:%M:%S %Z %Y")
    print(f"[{timestamp}] {msg}", flush=True)


STATUS_FILE = REPO_DIR / "data" / "relay-status.json"


def set_status(status: str) -> None:
    """Write agent status to a JSON file for dashboard/monitoring."""
    import json
    try:
        STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
        payload = {"status": status, "updated": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        tmp = STATUS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload))
        tmp.rename(STATUS_FILE)
    except OSError:
        pass  # Best-effort — don't crash the relay over status updates


def get_workspace_dir() -> Path:
    """Create and return workspace directory for this run."""
    timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    workspace = RUNS_DIR / timestamp
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace


def cleanup_old_workspaces(days: int = 7) -> None:
    """Remove workspace directories older than specified days."""
    if not RUNS_DIR.exists():
        return

    cutoff = time.time() - (days * 86400)
    try:
        for workspace in RUNS_DIR.iterdir():
            if workspace.is_dir() and workspace.stat().st_mtime < cutoff:
                shutil.rmtree(workspace, ignore_errors=True)
                log(f"Cleaned up old workspace: {workspace.name}")
    except Exception as e:
        log(f"Warning: workspace cleanup failed: {e}")


class Timer:
    """Shared timer for tracking run duration.

    Sessions run indefinitely until context fills to CONTEXT_THRESHOLD.
    No wall-clock time limit — succession is context-based only.
    """

    def __init__(self):
        self.start_time = time.time()

    def elapsed(self) -> int:
        """Seconds elapsed since start."""
        return int(time.time() - self.start_time)

    def remaining(self) -> int:
        """Always returns a large value — no time limit."""
        return 99999

    def is_expired(self) -> bool:
        """Never expires — sessions end on context fill, not wall clock."""
        return False

    def has_successor_time(self) -> bool:
        """Always true — no time-based constraints."""
        return True
