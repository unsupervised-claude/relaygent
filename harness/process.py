"""Claude subprocess management with hang detection."""
from __future__ import annotations

import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from config import CONTEXT_THRESHOLD, HANG_CHECK_DELAY, LOG_FILE, PROMPT_FILE, SILENCE_TIMEOUT, Timer, log
from jsonl_checks import (
    check_incomplete_exit,
    get_context_fill_from_jsonl,
    get_jsonl_size,
)

CONTEXT_PCT_FILE = Path("/tmp/relaygent-context-pct")


@dataclass
class ClaudeResult:
    """Result of Claude process execution."""
    exit_code: int
    hung: bool = False
    timed_out: bool = False
    no_output: bool = False
    incomplete: bool = False
    context_pct: float = 0.0

class ClaudeProcess:
    """Manages Claude subprocess with hang detection."""

    def __init__(self, session_id: str, timer: Timer, workspace: Path):
        self.session_id = session_id
        self.timer = timer
        self.workspace = workspace
        self.process: subprocess.Popen | None = None
        self._log_file = None
        self._context_warning_sent = False

    def _get_log_lines(self) -> int:
        try:
            if not LOG_FILE.exists():
                return 0
            with open(LOG_FILE) as f:
                return sum(1 for _ in f)
        except OSError:
            return 0

    def _check_for_hang(self, log_start: int) -> bool:
        try:
            if not LOG_FILE.exists():
                return False
            with open(LOG_FILE) as f:
                content = "".join(f.readlines()[log_start:])
            return any(s in content for s in ("No messages returned", "API Error"))
        except OSError:
            return False

    def get_context_fill(self) -> float:
        try:
            pct = float(CONTEXT_PCT_FILE.read_text().strip()) if CONTEXT_PCT_FILE.exists() else 0
            if pct > 0:
                return pct
        except (OSError, ValueError):
            pass
        return get_context_fill_from_jsonl(self.session_id, self.workspace)

    def _terminate(self) -> None:
        if not self.process or self.process.poll() is not None:
            return
        log("Terminating Claude process...")
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            log("Graceful terminate failed, killing...")
        self.process.kill()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            log("WARNING: Process did not die after kill")
            self.process = None

    def _close_log(self):
        if self._log_file and not self._log_file.closed:
            self._log_file.close()
        self._log_file = None

    def _open_log(self):
        self._close_log()
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        return open(LOG_FILE, "a")

    def start_fresh(self) -> int:
        log_start = self._get_log_lines()
        self._log_file = self._open_log()
        settings_file = str(Path(__file__).parent / "settings.json")
        try:
            with open(PROMPT_FILE) as stdin:
                self.process = subprocess.Popen(
                    ["claude",
                     "--print", "--dangerously-skip-permissions",
                     "--settings", settings_file,
                     "--session-id", self.session_id],
                    stdin=stdin,
                    stdout=self._log_file,
                    stderr=subprocess.STDOUT,
                    cwd=str(self.workspace),
                )
        except OSError:
            self._close_log()
            raise
        return log_start

    def resume(self, message: str) -> int:
        self._terminate()
        self._context_warning_sent = False
        log_start = self._get_log_lines()
        self._log_file = self._open_log()
        settings_file = str(Path(__file__).parent / "settings.json")
        cmd = ["claude", "--resume", self.session_id,
               "--print", "--dangerously-skip-permissions", "--settings", settings_file]
        try:
            self.process = subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=self._log_file,
                stderr=subprocess.STDOUT, cwd=str(self.workspace))
        except OSError:
            self._close_log()
            raise
        try:
            if self.process.stdin and not self.process.stdin.closed:
                self.process.stdin.write(message.encode())
                self.process.stdin.flush()
                self.process.stdin.close()
            else:
                log("WARNING: stdin unavailable (process may have exited)")
        except (BrokenPipeError, OSError) as e:
            log(f"WARNING: Could not write to Claude stdin: {e}")
        return log_start

    def monitor(self, log_start: int) -> ClaudeResult:
        """Monitor process with hang detection. Blocks until process exits."""
        attempt_start = time.time()
        hung, timed_out, last_hang_check = False, False, 0.0
        initial_jsonl_size = get_jsonl_size(self.session_id, self.workspace)
        last_jsonl_size, last_activity_time = initial_jsonl_size, time.time()

        while self.process.poll() is None:
            attempt_elapsed = time.time() - attempt_start

            if self.timer.is_expired():
                log("Time limit reached, terminating...")
                self._terminate()
                timed_out = True
                break

            if (attempt_elapsed >= HANG_CHECK_DELAY
                    and attempt_elapsed - last_hang_check >= HANG_CHECK_DELAY):
                last_hang_check = attempt_elapsed
                if self._check_for_hang(log_start):
                    log("Hang detected (error pattern), killing...")
                    hung = True
                    self._terminate()
                    break

            current_jsonl_size = get_jsonl_size(self.session_id, self.workspace)
            if current_jsonl_size > last_jsonl_size:
                last_jsonl_size = current_jsonl_size
                last_activity_time = time.time()
            elif time.time() - last_activity_time > SILENCE_TIMEOUT:
                log(f"Hang detected (no activity for {SILENCE_TIMEOUT}s), killing...")
                hung = True
                self._terminate()
                break

            if not self._context_warning_sent:
                current_fill = self.get_context_fill()
                if current_fill >= CONTEXT_THRESHOLD:
                    log(f"Context at {current_fill:.0f}% (hook handling wrap-up warning)")
                    self._context_warning_sent = True

            remaining = self.timer.remaining()
            sleep_s = 1 if remaining <= 60 else (5 if remaining <= 300 else 30)
            time.sleep(sleep_s)

        if self.process.poll() is None:
            try:
                self.process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                log("WARNING: Process stuck after monitor, force killing")
                self.process.kill()
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    log("WARNING: Process did not die after kill")
        no_output = get_jsonl_size(self.session_id, self.workspace) == initial_jsonl_size
        incomplete, _ = check_incomplete_exit(self.session_id, self.workspace)
        return ClaudeResult(exit_code=self.process.returncode or 0, hung=hung, timed_out=timed_out,
            no_output=no_output, incomplete=incomplete, context_pct=self.get_context_fill())
