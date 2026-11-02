import os
import signal

import pytest

from printer.__main__ import main


def test_main_exits_2_and_names_the_missing_variable_when_config_is_invalid(monkeypatch, capsys):
    monkeypatch.setenv("TENT_BASE_URL", "https://tent.example.org")
    monkeypatch.delenv("DEVICE_ID", raising=False)
    monkeypatch.setenv("DEVICE_SECRET", "sk_print_abc")

    with pytest.raises(SystemExit) as excinfo:
        main()

    assert excinfo.value.code == 2
    err = capsys.readouterr().err
    assert "DEVICE_ID is required" in err
    assert "sk_print_abc" not in err


def test_main_reads_dot_env_in_working_directory(monkeypatch, tmp_path, capsys):
    (tmp_path / ".env").write_text(
        "TENT_BASE_URL=https://tent.example.org\nDEVICE_SECRET=sk_print_from_file\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TENT_BASE_URL", raising=False)
    monkeypatch.delenv("DEVICE_ID", raising=False)
    monkeypatch.setenv("DEVICE_SECRET", "sk_print_from_env")

    with pytest.raises(SystemExit) as excinfo:
        main()

    # TENT_BASE_URL came from the file (else it would be the first error); DEVICE_ID is in neither.
    assert excinfo.value.code == 2
    assert "DEVICE_ID is required" in capsys.readouterr().err


@pytest.fixture
def restore_signal_handlers():
    saved = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    yield
    for sig, handler in saved.items():
        signal.signal(sig, handler)


@pytest.mark.parametrize("sig", [signal.SIGTERM, signal.SIGINT])
def test_main_turns_sigterm_and_sigint_into_a_stop_request_instead_of_dying(
    monkeypatch, restore_signal_handlers, sig
):
    monkeypatch.setenv("TENT_BASE_URL", "https://tent.example.org")
    monkeypatch.setenv("DEVICE_ID", "printer-sh001-reg1")
    monkeypatch.setenv("DEVICE_SECRET", "sk_print_abc")
    seen = {}

    def fake_run(config, api, cups, *, should_stop, **_):
        seen["before"] = should_stop()
        os.kill(os.getpid(), sig)  # systemd stop; default handling would kill the process here
        seen["after"] = should_stop()

    monkeypatch.setattr("printer.__main__.run", fake_run)

    main()

    assert seen == {"before": False, "after": True}
