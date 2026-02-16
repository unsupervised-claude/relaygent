#!/usr/bin/env python3
"""Relaygent - Autonomous context-based Claude runner."""

import os
import signal
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import (CONTEXT_THRESHOLD, HANG_CHECK_DELAY, MAX_RETRIES, Timer,
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

    def _sleep_wake_loop(self):
        """Run sleep/wake cycles. Returns ClaudeResult if context-full, None otherwise."""
        while True:
            result = self.sleep_mgr.auto_sleep_and_wake()
            if not result or not result.woken:
                return None
            time.sleep(3)
            try:
                log_start = self.claude.resume(result.wake_message)
            except OSError as e:
                log(f"Resume failed on wake: {e}, retrying...")
                time.sleep(5)
                continue
            claude_result = self.claude.monitor(log_start)
            if claude_result.timed_out:
                return None
            while claude_result.incomplete or claude_result.hung or claude_result.no_output:
                if self.timer.is_expired():
                    return None
                msg = "Hung during wake, resuming..." if claude_result.hung else "Exited mid-conversation, resuming..."
                log(msg)
                time.sleep(5)
                log_start = self.claude.resume("Continue where you left off.")
                claude_result = self.claude.monitor(log_start)
                if claude_result.timed_out:
                    return None
            if claude_result.exit_code != 0:
                log(f"Crashed during wake (exit={claude_result.exit_code}), resuming...")
                time.sleep(3)
                log_start = self.claude.resume("You crashed and were resumed. Continue where you left off.")
                claude_result = self.claude.monitor(log_start)
            if claude_result.context_pct >= CONTEXT_THRESHOLD:
                return claude_result

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
        crash_count = 0

        while not self.timer.is_expired():
            set_status("working")
            if session_established:
                msg = (f"Your previous API call failed after {HANG_CHECK_DELAY} seconds. "
                       f"Please proceed with the original instructions.")
                log_start = self.claude.resume(msg)
            else:
                log_start = self.claude.start_fresh()

            result = self.claude.monitor(log_start)
            if self.timer.is_expired():
                break

            if result.hung:
                set_status("crashed")
                log("Hung, resuming...")
                session_established = True
                time.sleep(15)
                continue

            if result.no_output:
                if session_established:
                    log("Resume failed (no session), starting fresh...")
                    session_id = str(uuid.uuid4())
                    self.claude.session_id = session_id
                    session_established = False
                else:
                    log("Exited without output, resuming...")
                    session_established = True
                time.sleep(5)
                continue

            if result.incomplete:
                log("Exited mid-conversation, resuming...")
                session_established = True
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
                time.sleep(15)
                continue

            if not should_sleep(self.claude.session_id, self.claude.workspace):
                log("Session incomplete (no stdout), resuming...")
                session_established = True
                time.sleep(2)
                continue

            session_established = True

            if result.context_pct >= CONTEXT_THRESHOLD and self.timer.has_successor_time():
                session_id = self._spawn_successor(
                    workspace, f"Context at {result.context_pct:.0f}%, spawning successor")
                session_established = False
                crash_count = 0
                continue

            wake_result = self._sleep_wake_loop()
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
