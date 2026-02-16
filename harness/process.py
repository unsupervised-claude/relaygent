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
        if not LOG_FILE.exists():
            return 0
        try:
            with open(LOG_FILE) as f:
                return sum(1 for _ in f)
        except OSError:
            return 0

    def _check_for_hang(self, log_start: int) -> bool:
        if not LOG_FILE.exists():
            return False
        try:
            with open(LOG_FILE) as f:
                lines = f.readlines()[log_start:]
            content = "".join(lines)
            return "No messages returned" in content or "API Error" in content
        except OSError:
            return False

    def get_context_fill(self) -> float:
        """Get current context window fill percentage."""
        try:
            if CONTEXT_PCT_FILE.exists():
                pct = float(CONTEXT_PCT_FILE.read_text().strip())
                if pct > 0:
                    return pct
        except (OSError, ValueError):
            pass
        return get_context_fill_from_jsonl(self.session_id, self.workspace)

    def _terminate(self) -> None:
        if self.process and self.process.poll() is None:
            log("Terminating Claude process...")
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
                log("Process terminated gracefully")
                return
            except subprocess.TimeoutExpired:
                pass
            log("Graceful terminate failed, killing...")
            self.process.kill()
            try:
                self.process.wait(timeout=10)
                log("Process killed successfully")
            except subprocess.TimeoutExpired:
                log("WARNING: Process did not die after kill, abandoning")
                self.process = None

    def _open_log(self):
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        return open(LOG_FILE, "a")

    def start_fresh(self) -> int:
        log_start = self._get_log_lines()
        self._log_file = self._open_log()
        settings_file = str(Path(__file__).parent / "settings.json")
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
        return log_start

    def resume(self, message: str) -> int:
        self._terminate()
        log_start = self._get_log_lines()
        self._log_file = self._open_log()
        settings_file = str(Path(__file__).parent / "settings.json")
        self.process = subprocess.Popen(
            ["claude",
             "--resume", self.session_id,
             "--print", "--dangerously-skip-permissions",
             "--settings", settings_file],
            stdin=subprocess.PIPE,
            stdout=self._log_file,
            stderr=subprocess.STDOUT,
            cwd=str(self.workspace),
        )
        self.process.stdin.write(message.encode())
        self.process.stdin.close()
        return log_start

    def monitor(self, log_start: int) -> ClaudeResult:
        """Monitor process with hang detection. Blocks until process exits."""
        attempt_start = time.time()
        hang_checked = False
        hung = False
        timed_out = False

        initial_jsonl_size = get_jsonl_size(self.session_id, self.workspace)
        last_jsonl_size = initial_jsonl_size
        last_activity_time = time.time()

        while self.process.poll() is None:
            attempt_elapsed = time.time() - attempt_start

            if self.timer.is_expired():
                log("Time limit reached, terminating...")
                self._terminate()
                timed_out = True
                break

            if not hang_checked and attempt_elapsed >= HANG_CHECK_DELAY:
                hang_checked = True
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
            if remaining <= 60:
                time.sleep(1)
            elif remaining <= 300:
                time.sleep(5)
            else:
                time.sleep(30)

        if self.process.poll() is None:
            self.process.wait()

        final_jsonl_size = get_jsonl_size(self.session_id, self.workspace)
        no_output = (final_jsonl_size == initial_jsonl_size)
        incomplete, _ = check_incomplete_exit(self.session_id, self.workspace)
        final_context = self.get_context_fill()

        return ClaudeResult(
            exit_code=self.process.returncode or 0,
            hung=hung,
            timed_out=timed_out,
            no_output=no_output,
            incomplete=incomplete,
            context_pct=final_context,
        )
