import logging
from collections.abc import Callable

from printer import VERSION
from printer.api import AuthError, BffClient, Hello, JobConflictError, NetworkError, ServerError
from printer.config import Config
from printer.cups import Cups
from printer.netinfo import local_ips as default_local_ips

log = logging.getLogger("printer")


class _Backoff:
    """Exponential delay 1, 2, 4, ... capped at max_sec."""

    def __init__(self, max_sec: float) -> None:
        self._max = max_sec
        self._next = 1.0

    def next(self) -> float:
        delay = min(self._next, self._max)
        self._next *= 2
        return delay

    def reset(self) -> None:
        self._next = 1.0


def _hello(
    config: Config,
    api: BffClient,
    cups: Cups,
    sleep: Callable[[float], None],
    agent_version: str,
) -> Hello:
    backoff = _Backoff(config.error_backoff_max_sec)
    while True:
        try:
            return api.hello(agent_version=agent_version, queue_state=cups.queue_state())
        except (AuthError, NetworkError, ServerError) as exc:
            log.error("hello failed: %s", exc)
            sleep(backoff.next())


def _boot_slip_text(hello: Hello, agent_version: str, ips: list[str]) -> str:
    lines = [
        "TENT PRINT AGENT",
        f"Name:    {hello.name}",
        f"Device:  {hello.device_id}",
        f"Shelter: {hello.shelter_code}",
        f"Version: {agent_version}",
        *(f"IP:      {ip}" for ip in ips or ["(none)"]),
    ]
    return "\n".join(lines) + "\n"


def _print_boot_slip(
    cups: Cups, hello: Hello, agent_version: str, local_ips: Callable[[], list[str]]
) -> None:
    """Best effort: a slip that fails to print must never stop the agent."""
    try:
        text = _boot_slip_text(hello, agent_version, local_ips())
        if cups.submit_text(text, "tent-boot-slip") is None:
            log.warning("boot slip not printed: lp failed")
    except Exception as exc:  # noqa: BLE001 - the slip is optional
        log.warning("boot slip not printed: %s", exc)


def _print_all(cups: Cups, labels: tuple[bytes, ...], timeout_sec: float) -> tuple[int, str | None]:
    """Print labels in order; stop at the first failure. Returns (printed, error_code)."""
    for printed, label in enumerate(labels):
        job_id = cups.submit(label)
        if job_id is None:
            log.error("lp failed on label %d of %d", printed + 1, len(labels))
            return printed, "lp_failed"
        outcome = cups.wait_done(job_id, timeout_sec)
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
) -> None:
    """Retry only the report (never the print) until the claim's lease budget is spent."""
    backoff = _Backoff(backoff_max_sec)
    while True:
        try:
            api.report_result(job_id, printed=printed, error_code=error_code)
            log.info("job %s reported printed=%d error_code=%s", job_id, printed, error_code)
            return
        except JobConflictError:
            log.warning("job %s result dropped: job is no longer ours", job_id)
            return
        except (AuthError, NetworkError, ServerError) as exc:
            if monotonic() >= deadline:
                log.error("job %s result not delivered within lease, giving up: %s", job_id, exc)
                return
            log.warning("job %s result report failed, retrying: %s", job_id, exc)
            sleep(backoff.next())


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
) -> None:
    hello = _hello(config, api, cups, sleep, agent_version)
    if config.boot_slip:
        _print_boot_slip(cups, hello, agent_version, local_ips)
    backoff = _Backoff(config.error_backoff_max_sec)
    iterations = 0
    while max_iterations is None or iterations < max_iterations:
        iterations += 1
        try:
            state = cups.ensure_enabled()
            claimed = api.next_job(queue_state=state)
            claimed_at = monotonic()
            backoff.reset()
            if claimed is None:
                if state != "ready":
                    sleep(config.idle_backoff_sec)
                continue
            log.info("job %s claimed labels=%d", claimed.id, len(claimed.labels))
            printed, error_code = _print_all(cups, claimed.labels, config.job_timeout_sec)
            _report(
                api,
                sleep,
                claimed.id,
                printed,
                error_code,
                config.error_backoff_max_sec,
                monotonic,
                deadline=claimed_at + hello.lease_sec,
            )
        except AuthError:
            log.error("device auth failed - check DEVICE_ID / DEVICE_SECRET")
            sleep(backoff.next())
        except (NetworkError, ServerError) as exc:
            log.warning("poll failed: %s", exc)
            sleep(backoff.next())
