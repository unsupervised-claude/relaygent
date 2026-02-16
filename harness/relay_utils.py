"""Utility functions for the relay harness."""

import fcntl
import os
import signal
import subprocess
import sys
from pathlib import Path

from config import LOG_FILE, LOG_MAX_SIZE, LOG_TRUNCATE_SIZE, REPO_DIR, SCRIPT_DIR, log

LOCK_FILE = SCRIPT_DIR / ".relay.lock"


def acquire_lock() -> int:
    """Acquire exclusive lock. Returns fd or exits if already locked."""
    fd = os.open(str(LOCK_FILE), os.O_RDWR | os.O_CREAT)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.ftruncate(fd, 0)
        os.write(fd, f"{os.getpid()}\n".encode())
        os.fsync(fd)
        return fd
    except BlockingIOError:
        os.close(fd)
        log("Another relay instance is running, exiting")
        sys.exit(0)


def kill_orphaned_claudes() -> None:
    """Kill any leftover claude --resume/--print processes."""
    result = subprocess.run(
        ["pgrep", "-f", "claude.*--print.*--session-id"],
        capture_output=True, text=True
    )
    if result.returncode == 0 and result.stdout.strip():
        for pid_str in result.stdout.strip().split('\n'):
            try:
                pid = int(pid_str)
                os.kill(pid, signal.SIGTERM)
                log(f"Sent SIGTERM to orphaned claude process {pid}")
            except (ProcessLookupError, ValueError):
                pass


def notify_crash(crash_count: int, exit_code: int) -> None:
    """Log crash notification. Override for custom alerting."""
    log(f"CRASH ALERT: Relay crashed {crash_count} times (exit code {exit_code}). "
        f"Manual intervention may be needed.")


def commit_kb() -> None:
    """Commit knowledge base changes."""
    commit_script = REPO_DIR / "knowledge" / "commit.sh"
    if commit_script.exists() and os.access(commit_script, os.X_OK):
        try:
            env = os.environ.copy()
            env["RELAY_RUN"] = "1"
            subprocess.run([str(commit_script)], env=env, capture_output=True, timeout=30)
            log("KB changes committed")
        except Exception:
            pass


def rotate_log() -> None:
    """Rotate the relay log if it exceeds the size limit."""
    if not LOG_FILE.exists():
        return
    try:
        size = LOG_FILE.stat().st_size
        if size > LOG_MAX_SIZE:
            content = LOG_FILE.read_bytes()[-LOG_TRUNCATE_SIZE:]
            LOG_FILE.write_bytes(content)
            log(f"Log rotated (was {size} bytes)")
    except OSError:
        pass


def cleanup_context_file() -> None:
    """Remove the context percentage tracking file."""
    pct_file = Path("/tmp/relaygent-context-pct")
    if pct_file.exists():
        pct_file.unlink()
