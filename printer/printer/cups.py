import os
import re
import subprocess
import time
from collections.abc import Callable

from printer.ipp import job_state as ipp_job_state

_REQUEST_ID = re.compile(r"request id is (\S+)")


class Cups:
    def __init__(
        self,
        printer_name: str,
        ppi: int,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        command_timeout: float = 10,
        job_state: Callable[[str], str | None] | None = None,
    ):
        self.printer_name = printer_name
        self.ppi = ppi
        self._sleep = sleep
        self._monotonic = monotonic
        self._command_timeout = command_timeout
        self._job_state = job_state or ipp_job_state

    def _run(self, args: list[str], input: bytes | None = None) -> tuple[int, str] | None:
        """Run a CUPS command; returns (exit code, stdout) or None if it could not run at all."""
        try:
            result = subprocess.run(
                args,
                input=input,
                capture_output=True,
                env={**os.environ, "LC_ALL": "C"},
                timeout=self._command_timeout,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return result.returncode, result.stdout.decode(errors="replace")

    def submit(self, png: bytes) -> str | None:
        result = self._run(
            ["lp", "-d", self.printer_name, "-t", "tent-print-job", "-o", f"ppi={self.ppi}", "-"],
            input=png,
        )
        if result is None or result[0] != 0:
            return None
        match = _REQUEST_ID.search(result[1])
        return match.group(1) if match else None

    def submit_text(self, text: str, title: str) -> str | None:
        """Print plain UTF-8 text (no ppi: CUPS' text filter, not the label path)."""
        result = self._run(["lp", "-d", self.printer_name, "-t", title, "-"], input=text.encode())
        if result is None or result[0] != 0:
            return None
        match = _REQUEST_ID.search(result[1])
        return match.group(1) if match else None

    def queue_state(self) -> str:
        result = self._run(["lpstat", "-p", self.printer_name])
        if result is None or result[0] != 0:
            return "missing"
        if f"printer {self.printer_name} disabled" in result[1]:
            return "disabled"
        return "ready"

    def ensure_enabled(self) -> str:
        state = self.queue_state()
        if state != "disabled":
            return state
        self._run(["cupsenable", self.printer_name])
        return self.queue_state()

    def wait_done(self, job_id: str, timeout_sec: float, poll_sec: float = 0.2) -> str:
        deadline = self._monotonic() + timeout_sec
        while True:
            pending = self._run(["lpstat", "-W", "not-completed", "-o", self.printer_name])
            if pending is None or not _lists_job(pending[1], job_id):
                break
            if self._monotonic() >= deadline:
                return "timeout"
            self._sleep(poll_sec)
        # job-state is authoritative; the "Alerts:" text is only a fallback when cupsd's IPP
        # endpoint can't be read (CUPS 2.3.3 shows processing-to-stop-point on printed jobs).
        state = self._job_state(job_id)
        if state == "completed":
            return "completed"
        if state in ("aborted", "canceled"):
            return "aborted"
        completed = self._run(["lpstat", "-l", "-W", "completed", "-o", self.printer_name])
        alerts = _alerts_for(completed[1], job_id) if completed else ""
        return "completed" if "job-completed-successfully" in alerts else "aborted"

    def cancel(self, job_id: str) -> None:
        self._run(["cancel", job_id])


def _lists_job(listing: str, job_id: str) -> bool:
    return any(line.split()[:1] == [job_id] for line in listing.splitlines())


def _alerts_for(listing: str, job_id: str) -> str:
    in_job = False
    for line in listing.splitlines():
        if line[:1].isspace():
            if in_job and line.strip().startswith("Alerts:"):
                return line.split("Alerts:", 1)[1]
        else:
            in_job = line.split()[:1] == [job_id]
    return ""
