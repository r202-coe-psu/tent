from pathlib import Path

import pytest

from scanner_client.config import ConfigError, load_settings, parse_shelter_origin, save_shelter_url


def write_env(tmp_path: Path, text: str) -> Path:
    path = tmp_path / ".env"
    path.write_text(text, encoding="utf-8")
    return path


def load(tmp_path: Path, file_text: str = "", environ: dict[str, str] | None = None, **kw):
    return load_settings(write_env(tmp_path, file_text), environ or {}, **kw)


def test_loads_minimal_env_file_with_defaults(tmp_path):
    settings = load(tmp_path, "SHELTER_URL=https://shelter.example\n", platform="linux")

    assert settings.shelter_origin == "https://shelter.example"
    assert settings.walk_in_path == "/onsite/people/new"
    assert settings.start_path == "/admin-login"
    assert settings.browser_channel == "chromium"
    assert settings.card_reader_name is None
    assert settings.keep_login is False
    assert settings.poll_interval == 0.5


def test_missing_env_file_still_works_from_process_env(tmp_path):
    settings = load_settings(
        tmp_path / "absent.env", {"SHELTER_URL": "https://shelter.example"}, platform="linux"
    )

    assert settings.shelter_origin == "https://shelter.example"


def test_process_env_overrides_env_file(tmp_path):
    settings = load(
        tmp_path,
        "SHELTER_URL=https://file.example\nWALK_IN_PATH=/from-file\n",
        {"SHELTER_URL": "https://env.example"},
        platform="linux",
    )

    assert settings.shelter_origin == "https://env.example"
    assert settings.walk_in_path == "/from-file"


def test_missing_shelter_url_names_the_key(tmp_path):
    with pytest.raises(ConfigError, match="SHELTER_URL"):
        load(tmp_path, "", platform="linux")


def test_plain_http_to_named_host_is_rejected_without_echoing_value(tmp_path):
    with pytest.raises(ConfigError) as err:
        load(tmp_path, "SHELTER_URL=http://example.org\n", platform="linux")

    assert "SHELTER_URL" in str(err.value)
    assert "example.org" not in str(err.value)


@pytest.mark.parametrize(
    ("url", "origin"),
    [
        ("http://localhost:5173", "http://localhost:5173"),
        ("http://127.0.0.1", "http://127.0.0.1"),
        ("http://127.3.4.5:8080/", "http://127.3.4.5:8080"),
        ("http://[::1]:5173", "http://[::1]:5173"),
    ],
)
def test_http_is_allowed_for_loopback_hosts(tmp_path, url, origin):
    assert load(tmp_path, f"SHELTER_URL={url}\n", platform="linux").shelter_origin == origin


# Edge CouchDB stack on the shelter LAN serves plain http (nginx-edge listens on :80 only).
@pytest.mark.parametrize(
    ("url", "origin"),
    [
        ("http://10.0.0.5", "http://10.0.0.5"),
        ("http://172.16.1.1", "http://172.16.1.1"),
        ("http://172.31.255.1:5984", "http://172.31.255.1:5984"),
        ("http://192.168.1.10:8080/", "http://192.168.1.10:8080"),
        ("http://169.254.10.20", "http://169.254.10.20"),
        ("http://[fd12:3456::1]", "http://[fd12:3456::1]"),
        ("http://[fe80::1]", "http://[fe80::1]"),
    ],
)
def test_http_is_allowed_for_private_lan_ips(tmp_path, url, origin):
    assert load(tmp_path, f"SHELTER_URL={url}\n", platform="linux").shelter_origin == origin


@pytest.mark.parametrize(
    "url",
    [
        "http://172.32.0.1",
        "http://8.8.8.8",
        "http://100.64.0.1",
        "http://0.0.0.0",
        "http://[2001:db8::1]",
        "http://192.168.1.10.nip.io",
    ],
)
def test_http_is_rejected_for_public_ips_and_named_hosts(tmp_path, url):
    with pytest.raises(ConfigError, match="SHELTER_URL must use https"):
        load(tmp_path, f"SHELTER_URL={url}\n", platform="linux")


@pytest.mark.parametrize(
    ("url", "origin"),
    [
        ("https://Shelter.Example:443/", "https://shelter.example"),
        ("https://shelter.example:8443", "https://shelter.example:8443"),
        ("http://LOCALHOST:80", "http://localhost"),
    ],
)
def test_origin_is_normalised_like_browser_location_origin(tmp_path, url, origin):
    assert load(tmp_path, f"SHELTER_URL={url}\n", platform="linux").shelter_origin == origin


@pytest.mark.parametrize(
    "url",
    [
        "https://shelter.example/app",
        "https://shelter.example/?x=1",
        "https://shelter.example/?",
        "https://shelter.example/#frag",
        "https://user:pw@shelter.example",
        "https://user@shelter.example",
        "ftp://shelter.example",
        "shelter.example",
        "https://shelter.example:notaport",
    ],
)
def test_shelter_url_must_be_a_bare_origin(tmp_path, url):
    with pytest.raises(ConfigError) as err:
        load(tmp_path, f"SHELTER_URL={url}\n", platform="linux")

    assert "SHELTER_URL" in str(err.value)
    assert "pw" not in str(err.value)


def test_walk_in_path_must_start_with_slash(tmp_path):
    with pytest.raises(ConfigError, match="WALK_IN_PATH"):
        load(tmp_path, "SHELTER_URL=https://a.example\nWALK_IN_PATH=onsite\n", platform="linux")


def test_walk_in_path_can_be_overridden(tmp_path):
    settings = load(
        tmp_path, "SHELTER_URL=https://a.example\nWALK_IN_PATH=/custom/new\n", platform="linux"
    )

    assert settings.walk_in_path == "/custom/new"


def test_browser_channel_defaults_to_msedge_on_windows(tmp_path):
    settings = load(tmp_path, "SHELTER_URL=https://a.example\n", platform="win32")

    assert settings.browser_channel == "msedge"


@pytest.mark.parametrize("channel", ["msedge", "chrome", "chromium"])
def test_browser_channel_explicit_choice_wins_over_platform(tmp_path, channel):
    settings = load(
        tmp_path, f"SHELTER_URL=https://a.example\nBROWSER_CHANNEL={channel}\n", platform="win32"
    )

    assert settings.browser_channel == channel


def test_bad_browser_channel_is_rejected_without_echoing_value(tmp_path):
    with pytest.raises(ConfigError) as err:
        load(tmp_path, "SHELTER_URL=https://a.example\nBROWSER_CHANNEL=firefox\n")

    assert "BROWSER_CHANNEL" in str(err.value)
    assert "firefox" not in str(err.value)


def test_card_reader_name_is_free_text(tmp_path):
    settings = load(
        tmp_path,
        "SHELTER_URL=https://a.example\nCARD_READER_NAME=ACS ACR39U 0\n",
        platform="linux",
    )

    assert settings.card_reader_name == "ACS ACR39U 0"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("true", True), ("TRUE", True), ("1", True), ("Yes", True)]
    + [("false", False), ("False", False), ("0", False), ("NO", False)],
)
def test_keep_login_accepts_boolean_spellings(tmp_path, raw, expected):
    settings = load(
        tmp_path, f"SHELTER_URL=https://a.example\nKEEP_LOGIN={raw}\n", platform="linux"
    )

    assert settings.keep_login is expected


def test_keep_login_rejects_anything_else(tmp_path):
    with pytest.raises(ConfigError) as err:
        load(tmp_path, "SHELTER_URL=https://a.example\nKEEP_LOGIN=maybe\n")

    assert "KEEP_LOGIN" in str(err.value)
    assert "maybe" not in str(err.value)


def test_poll_interval_accepts_float_within_bounds(tmp_path):
    settings = load(
        tmp_path, "SHELTER_URL=https://a.example\nPOLL_INTERVAL=0.2\n", platform="linux"
    )

    assert settings.poll_interval == 0.2


@pytest.mark.parametrize("raw", ["0.1", "10.5", "0.05", "-1", "fast", "nan", "inf"])
def test_poll_interval_out_of_bounds_or_not_a_number_is_rejected(tmp_path, raw):
    with pytest.raises(ConfigError) as err:
        load(tmp_path, f"SHELTER_URL=https://a.example\nPOLL_INTERVAL={raw}\n")

    assert "POLL_INTERVAL" in str(err.value)
    assert raw not in str(err.value)


def test_start_path_can_be_overridden(tmp_path):
    settings = load(tmp_path, "SHELTER_URL=https://a.example\nSTART_PATH=/\n", platform="linux")

    assert settings.start_path == "/"


def test_start_path_must_start_with_slash(tmp_path):
    with pytest.raises(ConfigError, match="START_PATH"):
        load(tmp_path, "SHELTER_URL=https://a.example\nSTART_PATH=admin-login\n", platform="linux")


def test_start_path_must_stay_on_the_shelter_origin(tmp_path):
    with pytest.raises(ConfigError, match="START_PATH"):
        load(
            tmp_path, "SHELTER_URL=https://a.example\nSTART_PATH=//evil.example\n", platform="linux"
        )


def test_shelter_url_can_be_left_for_the_startup_prompt(tmp_path):
    for text in ("", "SHELTER_URL=http://example.org\n"):
        settings = load(tmp_path, text, platform="linux", require_shelter_url=False)

        assert settings.shelter_origin == ""
        assert settings.walk_in_path == "/onsite/people/new"


def test_other_bad_keys_still_fail_when_the_shelter_url_is_optional(tmp_path):
    with pytest.raises(ConfigError, match="POLL_INTERVAL"):
        load(tmp_path, "POLL_INTERVAL=abc\n", platform="linux", require_shelter_url=False)


def test_parse_shelter_origin_is_the_same_rule_as_the_env_file():
    assert parse_shelter_origin(" https://Shelter.Example:443/ ") == "https://shelter.example"
    with pytest.raises(ConfigError, match="SHELTER_URL"):
        parse_shelter_origin("http://example.org")


def test_save_shelter_url_rewrites_only_that_key(tmp_path):
    path = write_env(tmp_path, "# note\nSHELTER_URL=https://old.example\nKEEP_LOGIN=true\n")

    save_shelter_url(path, "http://192.168.1.10")

    text = path.read_text(encoding="utf-8")
    assert "SHELTER_URL=http://192.168.1.10\n" in text
    assert "old.example" not in text
    assert "# note\n" in text and "KEEP_LOGIN=true\n" in text
    assert load_settings(path, {}, platform="linux").shelter_origin == "http://192.168.1.10"


def test_save_shelter_url_creates_a_missing_env_file(tmp_path):
    path = tmp_path / ".env"

    save_shelter_url(path, "https://shelter.example")

    assert load_settings(path, {}, platform="linux").shelter_origin == "https://shelter.example"


def test_label_printer_defaults_to_the_name_each_setup_guide_uses(tmp_path):
    # PRINTER.md names the Windows printer XP-365B; kiosk/setup_printer.sh makes the CUPS
    # queue tent_xprinter
    env = "SHELTER_URL=https://a.example\n"

    assert load(tmp_path, env, platform="win32").printer_name == "XP-365B"
    assert load(tmp_path, env, platform="linux").printer_name == "tent_xprinter"


def test_label_printer_name_can_be_changed(tmp_path):
    settings = load(
        tmp_path, "SHELTER_URL=https://a.example\nPRINTER_NAME=Label 2\n", platform="linux"
    )

    assert settings.printer_name == "Label 2"
