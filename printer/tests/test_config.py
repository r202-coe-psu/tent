import pytest

from printer.config import Config, ConfigError, load_config, read_env_file


def test_valid_env_loads_values_and_defaults():
    config = load_config(
        {
            "TENT_BASE_URL": "https://tent.example.org",
            "DEVICE_ID": "printer-sh001-reg1",
            "DEVICE_SECRET": "sk_print_abc",
            "PRINTER_NAME": "my_queue",
        }
    )

    assert config == Config(
        base_url="https://tent.example.org",
        device_id="printer-sh001-reg1",
        device_secret="sk_print_abc",
        printer_name="my_queue",
        ppi=203,
        job_timeout_sec=30,
        idle_backoff_sec=5,
        error_backoff_max_sec=60,
    )


VALID_ENV = {
    "TENT_BASE_URL": "https://tent.example.org",
    "DEVICE_ID": "printer-sh001-reg1",
    "DEVICE_SECRET": "sk_print_abc",
}


@pytest.mark.parametrize("name", ["TENT_BASE_URL", "DEVICE_ID", "DEVICE_SECRET"])
@pytest.mark.parametrize("blank", [None, "", "   "])
def test_missing_or_blank_required_var_names_the_variable(name, blank):
    environ = {**VALID_ENV}
    if blank is None:
        del environ[name]
    else:
        environ[name] = blank

    with pytest.raises(ConfigError, match=name):
        load_config(environ)


def test_printer_name_defaults_to_tent_xprinter():
    assert load_config(VALID_ENV).printer_name == "tent_xprinter"


@pytest.mark.parametrize(
    "base_url",
    [
        "http://192.168.1.10:5173",
        "http://127.0.0.1",
        "http://localhost:5173",
        "http://10.0.0.5",
        "http://169.254.1.1",
        "https://tent.example.org",
    ],
)
def test_base_url_accepts_https_or_http_on_local_hosts(base_url):
    assert load_config({**VALID_ENV, "TENT_BASE_URL": base_url}).base_url == base_url


@pytest.mark.parametrize(
    "base_url",
    ["http://tent.example.org", "http://8.8.8.8", "ftp://192.168.1.10", "tent.example.org"],
)
def test_base_url_rejects_plaintext_http_to_public_hosts(base_url):
    with pytest.raises(ConfigError, match="TENT_BASE_URL"):
        load_config({**VALID_ENV, "TENT_BASE_URL": base_url})


def test_optional_ints_are_parsed():
    config = load_config(
        {
            **VALID_ENV,
            "PRINT_PPI": "300",
            "PRINT_JOB_TIMEOUT_SEC": "45",
            "IDLE_BACKOFF_SEC": "2",
            "ERROR_BACKOFF_MAX_SEC": "120",
        }
    )

    assert (
        config.ppi,
        config.job_timeout_sec,
        config.idle_backoff_sec,
        config.error_backoff_max_sec,
    ) == (300, 45, 2, 120)


@pytest.mark.parametrize(
    "name", ["PRINT_PPI", "PRINT_JOB_TIMEOUT_SEC", "IDLE_BACKOFF_SEC", "ERROR_BACKOFF_MAX_SEC"]
)
@pytest.mark.parametrize("bad", ["abc", "1.5", "0", "-3"])
def test_optional_int_rejects_non_integer_or_non_positive(name, bad):
    with pytest.raises(ConfigError, match=name):
        load_config({**VALID_ENV, name: bad})


@pytest.mark.parametrize("suffix", ["/", "///"])
def test_trailing_slash_on_base_url_is_stripped(suffix):
    config = load_config({**VALID_ENV, "TENT_BASE_URL": "https://tent.example.org" + suffix})

    assert config.base_url == "https://tent.example.org"


@pytest.mark.parametrize(
    "overrides",
    [
        {"TENT_BASE_URL": "http://tent.example.org"},
        {"TENT_BASE_URL": ""},
        {"DEVICE_ID": ""},
        {"PRINT_PPI": "abc"},
        {"PRINT_JOB_TIMEOUT_SEC": "0"},
        {"IDLE_BACKOFF_SEC": "-1"},
        {"ERROR_BACKOFF_MAX_SEC": "x"},
    ],
)
def test_config_error_never_contains_device_secret(overrides):
    secret = "sk_print_TOPSECRET123"

    with pytest.raises(ConfigError) as excinfo:
        load_config({**VALID_ENV, "DEVICE_SECRET": secret, **overrides})

    assert secret not in str(excinfo.value)


def test_boot_slip_defaults_to_enabled():
    assert load_config(VALID_ENV).boot_slip is True


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1", True),
        ("true", True),
        ("TRUE", True),
        ("yes", True),
        ("0", False),
        ("false", False),
        ("False", False),
        ("no", False),
        (" no ", False),
    ],
)
def test_boot_slip_parses_boolean_words(raw, expected):
    assert load_config({**VALID_ENV, "BOOT_SLIP": raw}).boot_slip is expected


def test_blank_boot_slip_falls_back_to_default_enabled():
    assert load_config({**VALID_ENV, "BOOT_SLIP": "  "}).boot_slip is True


@pytest.mark.parametrize("bad", ["maybe", "2", "on", "enable"])
def test_boot_slip_rejects_unknown_words_naming_the_variable(bad):
    with pytest.raises(ConfigError, match="BOOT_SLIP"):
        load_config({**VALID_ENV, "BOOT_SLIP": bad})


def test_read_env_file_parses_keys_quotes_comments_and_export(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment line\n"
        "\n"
        "TENT_BASE_URL=http://172.20.10.2:5173\n"
        'DEVICE_ID="printer-kiosk-1"\n'
        "export DEVICE_SECRET='sk_print_abc'\n"
        "# PRINT_PPI=203   commented out\n"
        "BOOT_SLIP=0   # trailing comment\n",
        encoding="utf-8",
    )

    assert read_env_file(env_file) == {
        "TENT_BASE_URL": "http://172.20.10.2:5173",
        "DEVICE_ID": "printer-kiosk-1",
        "DEVICE_SECRET": "sk_print_abc",
        "BOOT_SLIP": "0",
    }


def test_read_env_file_returns_empty_when_file_is_missing(tmp_path):
    assert read_env_file(tmp_path / "missing.env") == {}
