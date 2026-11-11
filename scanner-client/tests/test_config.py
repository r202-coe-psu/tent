from pathlib import Path

import pytest

from scanner_client.config import ConfigError, load_settings


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
