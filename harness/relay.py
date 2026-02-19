#!/usr/bin/env python3
"""Relaygent - Autonomous context-based Claude runner."""

import os
import signal
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import (CONTEXT_THRESHOLD, HANG_CHECK_DELAY, INCOMPLETE_BASE_DELAY,
                     MAX_INCOMPLETE_RETRIES, MAX_RETRIES, SILENCE_TIMEOUT, Timer,
                     cleanup_old_workspaces, get_workspace_dir, log, set_status)
from jsonl_checks import should_sleep
from process import ClaudeProcess
from relay_utils import acquire_lock, cleanup_context_file, commit_kb, kill_orphaned_claudes, notify_crash, rotate_log
from session import SleepManager


class RelayRunner:
    """Main orchestrator for relay Claude runs."""

    def __init__(self):
        self.timer = Timer()
        self.sleep_mgr = SleepManager(self.timer)
        self.claude: ClaudeProcess | None = None

    def _spawn_successor(self, workspace, reason):
        """Spawn a successor session. Returns new session_id."""
        log(f"{reason} ({self.timer.remaining() // 60} min remaining)")
        commit_kb()
        cleanup_context_file()
        session_id = str(uuid.uuid4())
        self.claude = ClaudeProcess(session_id, self.timer, workspace)
        log(f"Successor session: {session_id}")
        time.sleep(3)
        return session_id

    def run(self) -> int:
        """Main entry point. Returns exit code."""
        rotate_log()
        workspace = get_workspace_dir()
        log(f"Workspace: {workspace}")
        cleanup_old_workspaces(days=7)

        timestamp_file = Path(__file__).parent / ".last_run_timestamp"
        timestamp_file.write_text(str(int(self.timer.start_time)))

        session_id = str(uuid.uuid4())
        log(f"Starting relay run (session: {session_id})")

        self.claude = ClaudeProcess(session_id, self.timer, workspace)

        def _shutdown(*_):
            set_status("off")
            if self.claude:
                self.claude._terminate()
            sys.exit(1)
        signal.signal(signal.SIGTERM, _shutdown)
        signal.signal(signal.SIGINT, _shutdown)
        session_established = False
        resume_reason = ""
        crash_count = 0
        incomplete_count = 0

        while not self.timer.is_expired():
            set_status("working")
            if session_established:
                log_start = self.claude.resume(resume_reason)
            else:
                log_start = self.claude.start_fresh()

            result = self.claude.monitor(log_start)
            if self.timer.is_expired():
                break

            if result.hung:
                set_status("crashed")
                log("Hung, resuming...")
                session_established = True
                resume_reason = ("An API error was detected (no response or repeated failures). "
                                 "Please proceed with the original instructions.")
                time.sleep(15)
                continue

            if result.no_output:
                if session_established:
                    log("Resume failed (no session), starting fresh...")
                    session_id = str(uuid.uuid4())
                    self.claude.session_id = session_id
                    session_established = False
                    resume_reason = ""
                else:
                    log("Exited without output, resuming...")
                    session_established = True
                    resume_reason = ("Your previous session exited without producing output. "
                                     "Please proceed with the original instructions.")
                time.sleep(5)
                continue

            if result.incomplete:
                incomplete_count += 1
                if incomplete_count > MAX_INCOMPLETE_RETRIES:
                    log(f"Too many incomplete exits ({incomplete_count}), starting fresh session...")
                    session_id = str(uuid.uuid4())
                    self.claude.session_id = session_id
                    session_established = False
                    resume_reason = ""
                    incomplete_count = 0
                    time.sleep(15)
                else:
                    delay = min(INCOMPLETE_BASE_DELAY * (2 ** (incomplete_count - 1)), 60)
                    log(f"Exited mid-conversation ({incomplete_count}/{MAX_INCOMPLETE_RETRIES}), "
                        f"resuming in {delay}s...")
                    session_established = True
                    resume_reason = "Continue where you left off."
                    time.sleep(delay)
                continue

            if result.context_too_large:
                log("Request too large — starting fresh session (not resuming)")
                session_id = str(uuid.uuid4())
                self.claude.session_id = session_id
                session_established = False
                incomplete_count = 0
                resume_reason = ""
                time.sleep(5)
                continue

            if result.exit_code != 0:
                set_status("crashed")
                crash_count += 1
                if crash_count > MAX_RETRIES:
                    log(f"Too many crashes ({crash_count}), giving up")
                    notify_crash(crash_count, result.exit_code)
                    break
                log(f"Crashed (exit={result.exit_code}), retrying ({crash_count}/{MAX_RETRIES})...")
                session_id = str(uuid.uuid4())
                self.claude.session_id = session_id
                session_established = False
                resume_reason = ""
                time.sleep(15)
                continue

            if not should_sleep(self.claude.session_id, self.claude.workspace):
                log("Session incomplete (no stdout), resuming...")
                session_established = True
                resume_reason = (f"Your previous API call failed after {SILENCE_TIMEOUT} seconds. "
                                 f"Please proceed with the original instructions.")
                time.sleep(2)
                continue

            session_established = True
            incomplete_count = 0
            crash_count = 0

            if result.context_pct >= CONTEXT_THRESHOLD and self.timer.has_successor_time():
                session_id = self._spawn_successor(
                    workspace, f"Context at {result.context_pct:.0f}%, spawning successor")
                session_established = False
                crash_count = 0
                continue

            wake_result = self.sleep_mgr.run_wake_cycle(self.claude)
            if (wake_result and wake_result.context_pct >= CONTEXT_THRESHOLD
                    and self.timer.has_successor_time()):
                session_id = self._spawn_successor(
                    workspace, f"Context at {wake_result.context_pct:.0f}% after wake")
                session_established = False
                crash_count = 0
                continue
            break

        commit_kb()
        set_status("off")
        cleanup_context_file()
        log("Relay run complete")
        return 0


def main() -> int:
    lock_fd = acquire_lock()  # Must keep fd open or lock releases
    kill_orphaned_claudes()
    try:
        return RelayRunner().run()
    finally:
        os.close(lock_fd)


if __name__ == "__main__":
    sys.exit(main())
