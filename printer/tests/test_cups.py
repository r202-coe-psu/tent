from conftest import FakeClock

from printer.cups import Cups

PNG = b"\x89PNG\r\n\x1a\n-fake-label"


def test_submit_sends_png_on_stdin_to_lp_and_returns_job_id(fake_cups):
    fake_cups.set("lp", out="request id is tent_xprinter-42 (1 file(s))\n")

    job_id = Cups("tent_xprinter", 203).submit(PNG)

    assert job_id == "tent_xprinter-42"
    assert fake_cups.lp_stdin() == PNG
    (call,) = fake_cups.calls("lp")
    assert call["argv"] == ["-d", "tent_xprinter", "-t", "tent-print-job", "-o", "ppi=203", "-"]
    assert call["lc_all"] == "C"


def test_submit_returns_none_when_lp_exits_non_zero(fake_cups):
    fake_cups.set("lp", out="request id is tent_xprinter-43 (1 file(s))\n", rc=1)

    assert Cups("tent_xprinter", 203).submit(PNG) is None


def test_submit_returns_none_when_output_has_no_request_id(fake_cups):
    fake_cups.set("lp", out="lp: something unexpected\n")

    assert Cups("tent_xprinter", 203).submit(PNG) is None


def test_queue_state_is_ready_when_printer_is_idle_and_enabled(fake_cups):
    fake_cups.set(
        "lpstat_p", out="printer tent_xprinter is idle.  enabled since Sun Oct 18 21:00:00 2026\n"
    )

    assert Cups("tent_xprinter", 203).queue_state() == "ready"
    (call,) = fake_cups.calls("lpstat")
    assert call["argv"] == ["-p", "tent_xprinter"]
    assert call["lc_all"] == "C"


def test_queue_state_is_disabled_when_lpstat_reports_disabled(fake_cups):
    fake_cups.set(
        "lpstat_p", out="printer tent_xprinter disabled since Sun Oct 18 21:00:00 2026 -\n"
    )

    assert Cups("tent_xprinter", 203).queue_state() == "disabled"


def test_queue_state_is_missing_when_lpstat_exits_non_zero(fake_cups):
    fake_cups.set(
        "lpstat_p", out='lpstat: Invalid destination name in list "tent_xprinter".\n', rc=1
    )

    assert Cups("tent_xprinter", 203).queue_state() == "missing"


DISABLED = "printer tent_xprinter disabled since Sun Oct 18 21:00:00 2026 -\n"
IDLE = "printer tent_xprinter is idle.  enabled since Sun Oct 18 21:00:00 2026\n"


def test_ensure_enabled_runs_cupsenable_once_and_reports_ready(fake_cups):
    fake_cups.set("lpstat_p", out=DISABLED)
    fake_cups.after_enable_lpstat_p_is(IDLE)

    assert Cups("tent_xprinter", 203).ensure_enabled() == "ready"
    (call,) = fake_cups.calls("cupsenable")
    assert call["argv"] == ["tent_xprinter"]
    assert call["lc_all"] == "C"


def test_ensure_enabled_stays_disabled_when_cupsenable_fails(fake_cups):
    fake_cups.set("lpstat_p", out=DISABLED)
    fake_cups.set("cupsenable", out="cupsenable: Operation not permitted\n", rc=1)

    assert Cups("tent_xprinter", 203).ensure_enabled() == "disabled"
    assert len(fake_cups.calls("cupsenable")) == 1


def test_ensure_enabled_does_not_call_cupsenable_when_queue_is_ready(fake_cups):
    fake_cups.set("lpstat_p", out=IDLE)

    assert Cups("tent_xprinter", 203).ensure_enabled() == "ready"
    assert fake_cups.calls("cupsenable") == []


def test_ensure_enabled_does_not_call_cupsenable_when_queue_is_missing(fake_cups):
    fake_cups.set("lpstat_p", rc=1)

    assert Cups("tent_xprinter", 203).ensure_enabled() == "missing"
    assert fake_cups.calls("cupsenable") == []


PI_COMPLETED_42 = """\
tent_xprinter-42        printer          15360   Thu Oct 22 17:57:56 2026
    Status:
    Alerts: processing-to-stop-point
    queued for tent_xprinter
"""


def test_wait_done_trusts_ipp_job_state_over_a_stale_alert(fake_cups):
    """CUPS 2.3.3 shows processing-to-stop-point on a job that printed fine."""
    fake_cups.set("lpstat_completed", out=PI_COMPLETED_42)
    fake_cups.job_states["tent_xprinter-42"] = "completed"

    assert cups_with(FakeClock()).wait_done("tent_xprinter-42", timeout_sec=30) == "completed"


def test_wait_done_is_aborted_when_ipp_says_aborted_or_canceled(fake_cups):
    fake_cups.set("lpstat_completed", out=COMPLETED)
    fake_cups.job_states["tent_xprinter-42"] = "aborted"
    fake_cups.job_states["tent_xprinter-43"] = "canceled"

    assert cups_with(FakeClock()).wait_done("tent_xprinter-42", timeout_sec=30) == "aborted"
    assert cups_with(FakeClock()).wait_done("tent_xprinter-43", timeout_sec=30) == "aborted"


def test_wait_done_falls_back_to_alerts_when_ipp_is_unavailable(fake_cups):
    fake_cups.set("lpstat_completed", out=PI_COMPLETED_42)

    assert cups_with(FakeClock()).wait_done("tent_xprinter-42", timeout_sec=30) == "aborted"


def cups_with(clock: FakeClock) -> Cups:
    return Cups("tent_xprinter", 203, sleep=clock.sleep, monotonic=clock.monotonic)


COMPLETED = """\
tent_xprinter-42        tent-printer    15360   Sun Oct 18 21:39:19 2026
\tStatus: 
\tAlerts: job-completed-successfully
\tqueued for tent_xprinter
tent_xprinter-41        tent-printer    12288   Thu Oct 15 15:50:40 2026
\tStatus: 
\tAlerts: job-aborted-by-system
\tqueued for tent_xprinter
"""
PENDING_42 = "tent_xprinter-42        tent-printer    15360   Sun Oct 18 21:39:19 2026\n"


def test_wait_done_is_completed_when_job_left_queue_with_success_alert(fake_cups):
    fake_cups.set("lpstat_pending", out="")
    fake_cups.set("lpstat_completed", out=COMPLETED)

    assert cups_with(FakeClock()).wait_done("tent_xprinter-42", timeout_sec=30) == "completed"
    pending_call = fake_cups.calls("lpstat")[0]
    assert pending_call["argv"] == ["-W", "not-completed", "-o", "tent_xprinter"]
    assert pending_call["lc_all"] == "C"
    completed_call = fake_cups.calls("lpstat")[1]
    assert completed_call["argv"] == ["-l", "-W", "completed", "-o", "tent_xprinter"]


def test_wait_done_is_aborted_when_job_left_queue_with_other_alert(fake_cups):
    fake_cups.set("lpstat_pending", out="")
    fake_cups.set("lpstat_completed", out=COMPLETED)

    assert cups_with(FakeClock()).wait_done("tent_xprinter-41", timeout_sec=30) == "aborted"


def test_wait_done_is_aborted_when_job_is_in_neither_listing(fake_cups):
    fake_cups.set("lpstat_pending", out="")
    fake_cups.set("lpstat_completed", out=COMPLETED)

    assert cups_with(FakeClock()).wait_done("tent_xprinter-99", timeout_sec=30) == "aborted"


def test_wait_done_does_not_confuse_job_4_with_job_42(fake_cups):
    fake_cups.set("lpstat_pending", out=PENDING_42)
    fake_cups.set("lpstat_completed", out=COMPLETED)

    assert cups_with(FakeClock()).wait_done("tent_xprinter-4", timeout_sec=30) == "aborted"


def test_wait_done_keeps_polling_while_job_is_not_completed(fake_cups):
    fake_cups.set("lpstat_pending", out=PENDING_42)
    fake_cups.set("lpstat_completed", out=COMPLETED)
    clock = FakeClock()
    clock.on_sleep = lambda count: fake_cups.set("lpstat_pending", out="") if count == 3 else None
    assert (
        cups_with(clock).wait_done("tent_xprinter-42", timeout_sec=30, poll_sec=0.5) == "completed"
    )
    assert clock.sleeps == [0.5, 0.5, 0.5]


def test_wait_done_times_out_when_job_stays_not_completed(fake_cups):
    fake_cups.set("lpstat_pending", out=PENDING_42)
    clock = FakeClock()

    assert cups_with(clock).wait_done("tent_xprinter-42", timeout_sec=1, poll_sec=0.25) == "timeout"
    assert clock.now == 1.0


def test_cancel_runs_cancel_with_job_id(fake_cups):
    Cups("tent_xprinter", 203).cancel("tent_xprinter-42")

    (call,) = fake_cups.calls("cancel")
    assert call["argv"] == ["tent_xprinter-42"]
    assert call["lc_all"] == "C"


def test_cancel_does_not_raise_when_cancel_fails(fake_cups):
    fake_cups.set("cancel", out="cancel: cancel-job failed: Forbidden\n", rc=1)

    Cups("tent_xprinter", 203).cancel("tent_xprinter-42")

    assert len(fake_cups.calls("cancel")) == 1


def test_missing_cups_binaries_are_handled_without_raising(tmp_path, monkeypatch):
    empty_bin = tmp_path / "empty-bin"
    empty_bin.mkdir()
    monkeypatch.setenv("PATH", str(empty_bin))
    cups = Cups("tent_xprinter", 203)

    assert cups.submit(PNG) is None
    assert cups.queue_state() == "missing"
    assert cups.ensure_enabled() == "missing"
    cups.cancel("tent_xprinter-42")


def test_submit_returns_none_when_lp_hangs_past_command_timeout(fake_cups):
    fake_cups.set("lp", out="request id is tent_xprinter-42 (1 file(s))\n", sleep=3)

    assert Cups("tent_xprinter", 203, command_timeout=0.2).submit(PNG) is None
