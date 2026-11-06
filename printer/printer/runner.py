import logging
import random
from collections.abc import Callable

from printer import VERSION
from printer.api import (
    AuthError,
    BffClient,
    Hello,
    JobConflictError,
    NetworkError,
    RejectedError,
    ServerError,
)
from printer.config import Config
from printer.cups import Cups
from printer.netinfo import local_ips as default_local_ips
from printer.slip import find_thai_font, render_slip_png

log = logging.getLogger("printer")


# Share of each delay that jitter may take off, so a fleet of agents does not retry in lockstep.
_JITTER_SHARE = 0.2
# A poll that returns sooner than this (an immediate 204) pauses so the loop cannot spin.
MIN_POLL_SEC = 1.0


class _Backoff:
    """Exponential delay 1, 2, 4, ... capped at max_sec, shortened by up to 20% of jitter."""

    def __init__(self, max_sec: float, jitter: Callable[[], float] = random.random) -> None:
        self._max = max_sec
        self._jitter = jitter
        self._next = 1.0

    def next(self) -> float:
        delay = min(self._next, self._max)
        self._next *= 2
        return delay * (1 - _JITTER_SHARE * self._jitter())

    def reset(self) -> None:
        self._next = 1.0


def _hello(
    config: Config,
    api: BffClient,
    cups: Cups,
    sleep: Callable[[float], None],
    agent_version: str,
    local_ips: Callable[[], list[str]],
    jitter: Callable[[], float],
    should_stop: Callable[[], bool],
) -> Hello | None:
    """The server's hello answer, or None when asked to stop before one arrived."""
    backoff = _Backoff(config.error_backoff_max_sec, jitter)
    while not should_stop():
        try:
            return api.hello(
                agent_version=agent_version,
                queue_state=cups.queue_state(),
                local_ips=local_ips(),
            )
        except (AuthError, NetworkError, ServerError) as exc:
            log.error("hello failed: %s", exc)
            sleep(backoff.next())
    return None


def _boot_slip_rows(hello: Hello, agent_version: str, ips: list[str]) -> list[tuple[str, str]]:
    return [
        ("", "TENT PRINT AGENT"),
        ("Name", hello.name),
        ("Device", hello.device_id),
        ("Shelter", hello.shelter_code),
        ("Version", agent_version),
        *(("IP", ip) for ip in ips or ["(none)"]),
    ]


def _boot_slip_text(rows: list[tuple[str, str]]) -> str:
    lines = (f"{label + ':' if label else '':<9}{value}".strip() for label, value in rows)
    return "\n".join(lines) + "\n"


def _print_boot_slip(
    cups: Cups, hello: Hello, agent_version: str, local_ips: Callable[[], list[str]]
) -> None:
    """Best effort: a slip that fails to print must never stop the agent.

    Drawn as an image so a Thai device name prints; plain text only when no Thai font is installed.
    """
    try:
        rows = _boot_slip_rows(hello, agent_version, local_ips())
        png = render_slip_png(rows, cups.ppi, find_thai_font())
        if png is not None:
            request = cups.submit(png, title="tent-boot-slip")
        else:
            log.warning("boot slip as plain text: no Thai font (apt install fonts-thai-tlwg)")
            request = cups.submit_text(_boot_slip_text(rows), "tent-boot-slip")
        if request is None:
            log.warning("boot slip not printed: lp failed")
    except Exception as exc:  # noqa: BLE001 - the slip is optional
        log.warning("boot slip not printed: %s", exc)


# Lease time kept back for the result report (and its retries), capped at half a short lease.
REPORT_RESERVE_SEC = 15


def _print_deadline(claimed_at: float, lease_sec: float) -> float:
    return claimed_at + lease_sec - min(REPORT_RESERVE_SEC, lease_sec / 2)


def _print_all(
    cups: Cups,
    labels: tuple[bytes, ...],
    timeout_sec: float,
    monotonic: Callable[[], float],
    deadline: float,
) -> tuple[int, str | None]:
    """Print labels in order; stop at the first failure. Returns (printed, error_code).

    Each label waits at most `timeout_sec`, and never past `deadline`: a job still printing when
    its lease runs out would be failed by the server sweeper while CUPS keeps going.
    """
    for printed, label in enumerate(labels):
        remaining = deadline - monotonic()
        if remaining <= 0:
            log.error("lease spent before label %d of %d", printed + 1, len(labels))
            return printed, "printer_timeout"
        job_id = cups.submit(label)
        if job_id is None:
            log.error("lp failed on label %d of %d", printed + 1, len(labels))
            return printed, "lp_failed"
        outcome = cups.wait_done(job_id, min(timeout_sec, remaining))
        if outcome == "timeout":
            cups.cancel(job_id)
            return printed, "printer_timeout"
        if outcome == "aborted":
            return printed, "queue_disabled"
    return len(labels), None


def _report(
    api: BffClient,
    sleep: Callable[[float], None],
    job_id: str,
    printed: int,
    error_code: str | None,
    backoff_max_sec: float,
    monotonic: Callable[[], float],
    deadline: float,
    jitter: Callable[[], float],
) -> None:
    """Retry only the report (never the print) until the claim's lease budget is spent."""
    backoff = _Backoff(backoff_max_sec, jitter)
    while True:
        try:
            api.report_result(job_id, printed=printed, error_code=error_code)
            log.info("job %s reported printed=%d error_code=%s", job_id, printed, error_code)
            return
        except JobConflictError:
            log.warning("job %s result dropped: job is no longer ours", job_id)
            return
        except RejectedError as exc:
            log.error("job %s result rejected by server, not retrying: %s", job_id, exc)
            return
        except (AuthError, NetworkError, ServerError) as exc:
            if monotonic() >= deadline:
                log.error("job %s result not delivered within lease, giving up: %s", job_id, exc)
                return
            log.warning("job %s result report failed, retrying: %s", job_id, exc)
            sleep(backoff.next())


_QUEUE_HINTS = {
    "missing": "check PRINTER_NAME / lpstat -p",
    "disabled": "check paper/power; see README 'Queue-enable rights'",
}


def _log_queue_change(queue: str, state: str, previous: str | None) -> None:
    """One log line per state change, so a stuck queue is visible without flooding the journal."""
    if state == previous:
        return
    if state != "ready":
        hint = _QUEUE_HINTS.get(state, "check CUPS").format(queue=queue)
        log.warning("printer queue %s is %s - %s", queue, state, hint)
    elif previous is not None:
        log.info("printer queue %s is ready", queue)


def run(
    config: Config,
    api: BffClient,
    cups: Cups,
    *,
    sleep: Callable[[float], None],
    monotonic: Callable[[], float],
    max_iterations: int | None = None,
    agent_version: str = VERSION,
    local_ips: Callable[[], list[str]] = default_local_ips,
    jitter: Callable[[], float] = random.random,
    should_stop: Callable[[], bool] = lambda: False,
) -> None:
    hello = _hello(config, api, cups, sleep, agent_version, local_ips, jitter, should_stop)
    if hello is None:
        return
    if config.boot_slip:
        _print_boot_slip(cups, hello, agent_version, local_ips)
    backoff = _Backoff(config.error_backoff_max_sec, jitter)
    iterations = 0
    last_state: str | None = None
    # `should_stop` (SIGTERM) is only read here, between jobs: a claimed job always prints and
    # reports, because the result API has no error code for "agent stopped midway".
    while not should_stop() and (max_iterations is None or iterations < max_iterations):
        iterations += 1
        try:
            state = cups.ensure_enabled()
            _log_queue_change(cups.printer_name, state, last_state)
            last_state = state
            polled_at = monotonic()
            claimed = api.next_job(queue_state=state)
            claimed_at = monotonic()
            backoff.reset()
            if claimed is None:
                if state != "ready":
                    sleep(config.idle_backoff_sec)
                elif claimed_at - polled_at < MIN_POLL_SEC:
                    sleep(MIN_POLL_SEC - (claimed_at - polled_at))
                continue
            log.info("job %s claimed labels=%d", claimed.id, len(claimed.labels))
            lease_sec = claimed.lease_sec or hello.lease_sec
            printed, error_code = _print_all(
                cups,
                claimed.labels,
                config.job_timeout_sec,
                monotonic,
                _print_deadline(claimed_at, lease_sec),
            )
            _report(
                api,
                sleep,
                claimed.id,
                printed,
                error_code,
                config.error_backoff_max_sec,
                monotonic,
                deadline=claimed_at + lease_sec,
                jitter=jitter,
            )
        except AuthError:
            log.error("device auth failed - check DEVICE_ID / DEVICE_SECRET")
            sleep(backoff.next())
        except (NetworkError, ServerError) as exc:
            log.warning("poll failed: %s", exc)
            sleep(backoff.next())
