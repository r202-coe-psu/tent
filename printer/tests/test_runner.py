import base64
import json
import logging
from dataclasses import dataclass, field, replace

import httpx
import pytest
from conftest import FakeClock

from printer.api import BffClient
from printer.config import Config
from printer.cups import Cups
from printer.runner import run

CONFIG = Config(
    base_url="https://tent.example.org",
    device_id="printer-sh001-reg1",
    device_secret="sk_print_abc",
    printer_name="tent_xprinter",
    job_timeout_sec=1,
    idle_backoff_sec=5,
    error_backoff_max_sec=60,
    boot_slip=False,
)
SLIP_CONFIG = replace(CONFIG, boot_slip=True)

HELLO = "/api/v1/printer/hello"
NEXT = "/api/v1/printer/jobs/next"

IDLE = "printer tent_xprinter is idle.  enabled since Sun Oct 18 21:00:00 2026\n"


def hello_ok(lease_sec: int = 60) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "device": {
                "device_id": "printer-sh001-reg1",
                "name": "Registration desk 1",
                "shelter_code": "SH001",
            },
            "server_time": "2026-10-22T10:00:00.000Z",
            "config": {"wait_sec": 25, "lease_sec": lease_sec},
        },
    )


LP_OK = "request id is tent_xprinter-42 (1 file(s))\n"
COMPLETED_42 = """\
tent_xprinter-42        tent-printer    15360   Sun Oct 18 21:39:19 2026
\tStatus: 
\tAlerts: job-completed-successfully
\tqueued for tent_xprinter
"""
PENDING_42 = "tent_xprinter-42        tent-printer    15360   Sun Oct 18 21:39:19 2026\n"
JOB_ID = "print_job:01J9ZABC"
LABEL_1 = b"\x89PNG-fake-label-1"
LABEL_2 = b"\x89PNG-fake-label-2"


def job_response(*labels: bytes, job_id: str = JOB_ID) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "job": {
                "id": job_id,
                "label_count": len(labels),
                "lease_until": "2026-10-22T10:00:30.000Z",
            },
            "labels": [base64.b64encode(label).decode() for label in labels],
        },
    )


@dataclass
class Server:
    """Scripted BFF behind httpx.MockTransport; records every request it receives."""

    requests: list[tuple[str, dict]] = field(default_factory=list)
    scripts: dict[str, list] = field(
        default_factory=lambda: {"hello": [], "next": [], "result": []}
    )

    def script(self, kind: str, *items: httpx.Response | Exception) -> None:
        self.scripts[kind].extend(items)

    def paths(self) -> list[str]:
        return [path for path, _ in self.requests]

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append((path, json.loads(request.content)))
        kind = "hello" if path == HELLO else "next" if path == NEXT else "result"
        defaults = {
            "hello": hello_ok(),
            "next": httpx.Response(204),
            "result": httpx.Response(200, json={"status": "printed"}),
        }
        item = self.scripts[kind].pop(0) if self.scripts[kind] else defaults[kind]
        if isinstance(item, Exception):
            raise item
        return item


@dataclass
class Agent:
    server: Server
    clock: FakeClock
    cups_clock: FakeClock = field(default_factory=FakeClock)
    config: Config = CONFIG

    def run(self, max_iterations: int | None = 1, **kwargs) -> None:
        cups = Cups(
            "tent_xprinter", 203, sleep=self.cups_clock.sleep, monotonic=self.cups_clock.monotonic
        )
        api = BffClient(self.config, transport=httpx.MockTransport(self.server.handler))
        run(
            self.config,
            api,
            cups,
            sleep=self.clock.sleep,
            monotonic=self.clock.monotonic,
            max_iterations=max_iterations,
            **kwargs,
        )


@pytest.fixture
def agent(fake_cups) -> Agent:
    fake_cups.set("lpstat_p", out=IDLE)
    return Agent(Server(), FakeClock())


def test_hello_is_sent_with_agent_version_and_queue_state_before_first_poll(agent):
    agent.run(max_iterations=1, agent_version="9.9.9")

    assert agent.server.paths() == [HELLO, NEXT]
    assert agent.server.requests[0][1] == {"agent_version": "9.9.9", "queue_state": "ready"}


def test_hello_failures_back_off_and_retry_before_the_loop_starts(agent):
    agent.server.script(
        "hello",
        httpx.ConnectError("refused"),
        httpx.Response(503, json={"error": {"code": "DEPENDENCY_UNAVAILABLE", "message": "down"}}),
        httpx.Response(401, json={"error": {"code": "DEVICE_AUTH_FAILED", "message": "bad"}}),
    )

    agent.run(max_iterations=1)

    assert agent.server.paths() == [HELLO, HELLO, HELLO, HELLO, NEXT]
    assert agent.clock.sleeps == [1, 2, 4]


def test_claimed_job_prints_every_label_then_reports_all_printed(agent, fake_cups):
    fake_cups.set("lp", out=LP_OK)
    fake_cups.set("lpstat_completed", out=COMPLETED_42)
    agent.server.script("next", job_response(LABEL_1, LABEL_2))

    agent.run(max_iterations=1)

    assert fake_cups.lp_stdins() == [LABEL_1, LABEL_2]
    assert agent.server.requests[-1] == (
        "/api/v1/printer/jobs/print_job:01J9ZABC/result",
        {"printed": 2},
    )


def test_lp_failure_on_second_label_reports_one_printed_and_never_reprints(agent, fake_cups):
    fake_cups.set("lp", out=LP_OK)
    fake_cups.set_nth("lp", 2, rc=1)
    fake_cups.set("lpstat_completed", out=COMPLETED_42)
    agent.server.script("next", job_response(LABEL_1, LABEL_2))

    agent.run(max_iterations=1)

    assert len(fake_cups.calls("lp")) == 2
    assert agent.server.requests[-1][1] == {"printed": 1, "error_code": "lp_failed"}


def test_printer_timeout_on_second_label_cancels_cups_job_and_reports_one_printed(agent, fake_cups):
    fake_cups.set("lp", out=LP_OK)
    fake_cups.set("lpstat_completed", out=COMPLETED_42)
    fake_cups.set("lpstat_pending", out=PENDING_42)
    fake_cups.set_nth("lpstat_pending", 1, out="")
    agent.server.script("next", job_response(LABEL_1, LABEL_2))

    agent.run(max_iterations=1)

    assert [call["argv"] for call in fake_cups.calls("cancel")] == [["tent_xprinter-42"]]
    assert agent.cups_clock.now >= CONFIG.job_timeout_sec
    assert agent.server.requests[-1][1] == {"printed": 1, "error_code": "printer_timeout"}


def test_aborted_cups_job_on_second_label_reports_queue_disabled(agent, fake_cups):
    fake_cups.set("lp", out=LP_OK)
    fake_cups.set("lpstat_completed", out=COMPLETED_42)
    fake_cups.set_nth(
        "lpstat_completed",
        2,
        out=COMPLETED_42.replace("job-completed-successfully", "job-aborted-by-system"),
    )
    agent.server.script("next", job_response(LABEL_1, LABEL_2))

    agent.run(max_iterations=1)

    assert len(fake_cups.calls("lp")) == 2
    assert agent.server.requests[-1][1] == {"printed": 1, "error_code": "queue_disabled"}


def test_empty_poll_with_queue_not_ready_sleeps_idle_backoff_and_reports_state(agent, fake_cups):
    fake_cups.set(
        "lpstat_p", out="printer tent_xprinter disabled since Sun Oct 18 21:00:00 2026 -\n"
    )

    agent.run(max_iterations=2)

    assert [body for path, body in agent.server.requests if path == NEXT] == [
        {"queue_state": "disabled"},
        {"queue_state": "disabled"},
    ]
    assert len(fake_cups.calls("cupsenable")) == 2
    assert agent.clock.sleeps == [5, 5]


def test_empty_poll_with_queue_ready_polls_again_immediately(agent):
    agent.run(max_iterations=3)

    assert agent.server.paths() == [HELLO, NEXT, NEXT, NEXT]
    assert agent.clock.sleeps == []


def error_503() -> httpx.Response:
    return httpx.Response(
        503, json={"error": {"code": "DEPENDENCY_UNAVAILABLE", "message": "down"}}
    )


def error_401() -> httpx.Response:
    return httpx.Response(401, json={"error": {"code": "DEVICE_AUTH_FAILED", "message": "bad"}})


def test_poll_errors_back_off_exponentially_and_a_successful_poll_resets_it(agent):
    agent.server.script(
        "next",
        httpx.ConnectError("refused"),
        error_503(),
        error_401(),
        httpx.Response(204),
        httpx.ConnectError("refused"),
    )

    agent.run(max_iterations=5)

    assert agent.clock.sleeps == [1, 2, 4, 1]


def test_poll_error_backoff_is_capped_at_error_backoff_max_sec(agent):
    agent.server.script("next", *[error_503() for _ in range(8)])

    agent.run(max_iterations=8)

    assert agent.clock.sleeps == [1, 2, 4, 8, 16, 32, 60, 60]


RESULT = "/api/v1/printer/jobs/print_job:01J9ZABC/result"


def prepare_printed_job(fake_cups, agent) -> None:
    fake_cups.set("lp", out=LP_OK)
    fake_cups.set("lpstat_completed", out=COMPLETED_42)
    agent.server.script("next", job_response(LABEL_1))


def test_report_result_is_retried_with_backoff_without_reprinting(agent, fake_cups):
    prepare_printed_job(fake_cups, agent)
    agent.server.script("result", httpx.ConnectError("refused"), error_503())

    agent.run(max_iterations=1)

    assert agent.server.paths() == [HELLO, NEXT, RESULT, RESULT, RESULT]
    assert agent.clock.sleeps == [1, 2]
    assert len(fake_cups.calls("lp")) == 1


def test_report_result_gives_up_once_the_lease_budget_is_spent_and_moves_on(agent, fake_cups):
    prepare_printed_job(fake_cups, agent)
    agent.server.script("hello", hello_ok(lease_sec=10))
    agent.server.script(
        "result",
        httpx.ConnectError("refused"),
        error_503(),
        httpx.ConnectError("refused"),
        error_503(),
        httpx.ConnectError("refused"),
        httpx.ConnectError("refused"),
    )

    agent.run(max_iterations=2)

    assert agent.server.paths() == [HELLO, NEXT, RESULT, RESULT, RESULT, RESULT, RESULT, NEXT]
    assert agent.clock.sleeps == [1, 2, 4, 8]
    assert len(fake_cups.calls("lp")) == 1


def test_report_result_conflict_is_dropped_immediately_and_the_loop_moves_on(agent, fake_cups):
    prepare_printed_job(fake_cups, agent)
    agent.server.script(
        "result",
        httpx.Response(409, json={"error": {"code": "JOB_NOT_PRINTING", "message": "not yours"}}),
    )

    agent.run(max_iterations=2)

    assert agent.server.paths() == [HELLO, NEXT, RESULT, NEXT]
    assert agent.clock.sleeps == []


def test_logs_job_id_label_count_and_error_code_but_never_secret_or_label_bytes(
    agent, fake_cups, caplog
):
    caplog.set_level(logging.DEBUG, logger="printer")
    fake_cups.set("lp", out=LP_OK)
    fake_cups.set_nth("lp", 2, rc=1)
    fake_cups.set("lpstat_completed", out=COMPLETED_42)
    agent.server.script("next", error_401(), job_response(LABEL_1, LABEL_2))

    agent.run(max_iterations=2)

    printer_logs = [r for r in caplog.records if r.name == "printer"]
    text = "\n".join(r.getMessage() for r in printer_logs)
    assert any(r.levelno >= logging.ERROR for r in printer_logs)
    assert JOB_ID in text
    assert "labels=2" in text
    assert "printed=1" in text
    assert "lp_failed" in text
    assert CONFIG.device_secret not in caplog.text
    assert "fake-label" not in caplog.text
    assert base64.b64encode(LABEL_1).decode() not in caplog.text
    assert LABEL_1.hex() not in caplog.text


def lp_calls_with_title(fake_cups, title: str) -> list[dict]:
    return [c for c in fake_cups.calls("lp") if c["argv"][2:4] == ["-t", title]]


def test_boot_slip_is_printed_once_after_hello_with_identity_version_and_ips(agent, fake_cups):
    agent.config = SLIP_CONFIG

    agent.run(
        max_iterations=3,
        agent_version="9.9.9",
        local_ips=lambda: ["192.168.1.50", "10.0.0.7"],
    )

    slips = lp_calls_with_title(fake_cups, "tent-boot-slip")
    assert [call["argv"] for call in slips] == [
        ["-d", "tent_xprinter", "-t", "tent-boot-slip", "-"]
    ]
    text = fake_cups.lp_stdin().decode("utf-8")
    assert "Registration desk 1" in text
    assert "printer-sh001-reg1" in text
    assert "SH001" in text
    assert "9.9.9" in text
    assert "192.168.1.50" in text
    assert "10.0.0.7" in text
    assert agent.server.paths()[0] == HELLO


def test_boot_slip_is_not_printed_when_boot_slip_is_disabled(agent, fake_cups):
    agent.run(max_iterations=2, local_ips=lambda: ["192.168.1.50"])

    assert fake_cups.calls("lp") == []


def test_failing_boot_slip_is_logged_and_the_agent_keeps_polling(agent, fake_cups, caplog):
    agent.config = SLIP_CONFIG
    fake_cups.set("lp", rc=1)

    agent.run(max_iterations=2, local_ips=lambda: ["192.168.1.50"])

    assert agent.server.paths() == [HELLO, NEXT, NEXT]
    assert any(
        r.levelno == logging.WARNING and "boot slip" in r.getMessage() for r in caplog.records
    )
