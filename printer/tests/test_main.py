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
