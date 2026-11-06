import base64
import json
import logging
from collections.abc import Callable
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
RESULT = f"/api/v1/printer/jobs/{JOB_ID}/result"
LABEL_1 = b"\x89PNG-fake-label-1"
LABEL_2 = b"\x89PNG-fake-label-2"


def job_response(
    *labels: bytes, job_id: str = JOB_ID, lease_sec: int | None = None
) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "job": {
                "id": job_id,
                "label_count": len(labels),
                "lease_until": "2026-10-22T10:00:30.000Z",
                **({"lease_sec": lease_sec} if lease_sec is not None else {}),
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
    # Called when the default empty long poll answers (a real one takes ~25 s to time out).
    on_idle_poll: Callable[[], None] = lambda: None

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
        if kind == "next" and not self.scripts[kind]:
            self.on_idle_poll()
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
        kwargs.setdefault("jitter", lambda: 0.0)
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
    clock = FakeClock()
    return Agent(Server(on_idle_poll=lambda: setattr(clock, "now", clock.now + 25)), clock)


def test_hello_is_sent_with_agent_version_queue_state_and_ips_before_first_poll(agent):
    agent.run(max_iterations=1, agent_version="9.9.9", local_ips=lambda: ["192.168.1.50"])

    assert agent.server.paths() == [HELLO, NEXT]
    assert agent.server.requests[0][1] == {
        "agent_version": "9.9.9",
        "queue_state": "ready",
        "local_ips": ["192.168.1.50"],
    }


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


def test_label_wait_is_capped_by_the_lease_so_the_report_lands_before_the_sweeper(agent, fake_cups):
    agent.config = replace(CONFIG, job_timeout_sec=30)
    agent.cups_clock = agent.clock  # one clock, as in production
    fake_cups.set("lp", out=LP_OK)
    fake_cups.set("lpstat_pending", out=PENDING_42)
    agent.server.script("next", job_response(LABEL_1, LABEL_2, lease_sec=40))

    agent.run(max_iterations=1)

    # 40 s lease minus the 15 s report reserve leaves 25 s to print, not the 30 s label timeout.
    assert 25 <= agent.clock.now < 26
    assert len(fake_cups.calls("lp")) == 1
    assert agent.server.requests[-1] == (RESULT, {"printed": 0, "error_code": "printer_timeout"})


def test_malformed_poll_response_backs_off_instead_of_crashing(agent):
    agent.server.script("next", httpx.Response(200, text="<html>proxy error</html>"))

    agent.run(max_iterations=2)

    assert agent.server.paths() == [HELLO, NEXT, NEXT]
    assert agent.clock.sleeps == [1]


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


def test_instant_empty_polls_pause_briefly_instead_of_spinning(agent):
    agent.server.on_idle_poll = lambda: None
    agent.run(max_iterations=3)

    assert agent.server.paths() == [HELLO, NEXT, NEXT, NEXT]
    assert agent.clock.sleeps == [1.0, 1.0, 1.0]


def test_empty_poll_after_a_full_long_poll_does_not_sleep(agent):
    agent.run(max_iterations=2)

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

    # the instant 204 pauses 1 s, then the next error restarts the backoff at 1
    assert agent.clock.sleeps == [1, 2, 4, 1, 1]


def test_poll_error_backoff_is_capped_at_error_backoff_max_sec(agent):
    agent.server.script("next", *[error_503() for _ in range(8)])

    agent.run(max_iterations=8)

    assert agent.clock.sleeps == [1, 2, 4, 8, 16, 32, 60, 60]


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


def test_report_retries_are_bounded_by_the_claimed_job_lease_not_the_hello_default(
    agent, fake_cups
):
    fake_cups.set("lp", out=LP_OK)
    fake_cups.set("lpstat_completed", out=COMPLETED_42)
    agent.server.script("hello", hello_ok(lease_sec=1000))
    agent.server.script("next", job_response(LABEL_1, lease_sec=10))
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


def test_boot_slip_falls_back_to_plain_text_when_it_cannot_be_drawn(
    agent, fake_cups, monkeypatch
):
    monkeypatch.setattr("printer.runner.render_slip_png", lambda *_a, **_k: None)
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


def test_boot_slip_is_drawn_as_an_image_with_thai_safe_rows(agent, fake_cups, monkeypatch):
    drawn: list[tuple[list[tuple[str, str]], int]] = []

    def fake_render(rows, ppi, font_path):
        drawn.append((rows, ppi))
        return b"\x89PNG-fake-slip"

    monkeypatch.setattr("printer.runner.render_slip_png", fake_render)
    monkeypatch.setattr("printer.runner.find_thai_font", lambda: "/fonts/Loma.ttf")
    agent.config = SLIP_CONFIG

    agent.run(max_iterations=2, agent_version="9.9.9", local_ips=lambda: ["192.168.1.50"])

    slips = lp_calls_with_title(fake_cups, "tent-boot-slip")
    assert [call["argv"] for call in slips] == [
        ["-d", "tent_xprinter", "-t", "tent-boot-slip", "-o", "ppi=203", "-"]
    ]
    assert fake_cups.lp_stdin() == b"\x89PNG-fake-slip"
    [(rows, ppi)] = drawn
    assert ppi == 203
    assert ("Name", "Registration desk 1") in rows
    assert ("Device", "printer-sh001-reg1") in rows
    assert ("Shelter", "SH001") in rows
    assert ("Version", "9.9.9") in rows
    assert ("IP", "192.168.1.50") in rows


@pytest.mark.parametrize(
    ("font", "expected"),
    [(None, "no Thai font"), ("/fonts/Loma.ttf", "cannot draw the image")],
)
def test_plain_text_boot_slip_logs_why_it_was_not_drawn(
    agent, fake_cups, monkeypatch, caplog, font, expected
):
    monkeypatch.setattr("printer.runner.find_thai_font", lambda: font)
    monkeypatch.setattr("printer.runner.render_slip_png", lambda *_a, **_k: None)
    agent.config = SLIP_CONFIG

    agent.run(max_iterations=1, local_ips=lambda: ["192.168.1.50"])

    assert any(expected in r.getMessage() for r in caplog.records)


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


def test_queue_not_ready_is_logged_once_per_state_change_with_queue_name(agent, fake_cups, caplog):
    caplog.set_level(logging.INFO, logger="printer")
    fake_cups.set("lpstat_p", out="", rc=1)  # queue missing

    agent.run(max_iterations=3)

    queue_logs = [r for r in caplog.records if r.name == "printer" and "queue" in r.getMessage()]
    assert [(r.levelname, r.getMessage()) for r in queue_logs] == [
        ("WARNING", "printer queue tent_xprinter is missing - check PRINTER_NAME / lpstat -p"),
    ]


def test_disabled_queue_hint_points_to_readme_and_never_suggests_lpadmin(agent, fake_cups, caplog):
    caplog.set_level(logging.INFO, logger="printer")
    fake_cups.set(
        "lpstat_p", out="printer tent_xprinter disabled since Sun Oct 18 21:00:00 2026 -\n"
    )

    agent.run(max_iterations=1)

    [message] = [
        r.getMessage()
        for r in caplog.records
        if r.name == "printer" and "tent_xprinter is disabled" in r.getMessage()
    ]
    assert "lpadmin" not in message
    assert "README" in message


def test_report_result_is_not_retried_on_a_definitive_client_error(agent, fake_cups):
    prepare_printed_job(fake_cups, agent)
    agent.server.script("result", httpx.Response(404, json={}))

    agent.run(max_iterations=2)

    assert agent.server.paths() == [HELLO, NEXT, RESULT, NEXT]
    assert len(fake_cups.calls("lp")) == 1


def test_report_result_still_retries_429_and_408(agent, fake_cups):
    prepare_printed_job(fake_cups, agent)
    agent.server.script("result", httpx.Response(429, json={}), httpx.Response(408, json={}))

    agent.run(max_iterations=1)

    assert agent.server.paths() == [HELLO, NEXT, RESULT, RESULT, RESULT]


def test_non_numeric_lease_sec_from_the_server_does_not_crash_the_agent(agent, fake_cups):
    prepare_printed_job(fake_cups, agent)
    agent.server.script("next", job_response(LABEL_1, lease_sec="soon"))  # type: ignore[arg-type]

    agent.run(max_iterations=1)

    assert agent.server.requests[-1] == (RESULT, {"printed": 1})


def test_backoff_has_jitter_that_never_exceeds_the_cap(agent):
    agent.server.script("next", *[error_503() for _ in range(8)])

    agent.run(max_iterations=8, jitter=lambda: 1.0)

    assert agent.clock.sleeps == pytest.approx([0.8 * d for d in [1, 2, 4, 8, 16, 32, 60, 60]])


def test_stop_requested_mid_job_finishes_and_reports_the_job_then_exits_without_polling_again(
    agent, fake_cups
):
    fake_cups.set("lp", out=LP_OK)
    fake_cups.set("lpstat_completed", out=COMPLETED_42)
    agent.server.script("next", job_response(LABEL_1, LABEL_2))

    # SIGTERM lands once the job is claimed: the flag is up while its labels are printing.
    agent.run(max_iterations=5, should_stop=lambda: NEXT in agent.server.paths())

    assert fake_cups.lp_stdins() == [LABEL_1, LABEL_2]
    assert agent.server.requests[-1] == (RESULT, {"printed": 2})
    assert agent.server.paths() == [HELLO, NEXT, RESULT]


def test_stop_requested_while_hello_keeps_failing_gives_up_instead_of_retrying(agent):
    agent.server.script("hello", httpx.ConnectError("down"))

    agent.run(max_iterations=5, should_stop=lambda: len(agent.server.requests) >= 1)

    assert agent.server.paths() == [HELLO]
