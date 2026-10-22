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
