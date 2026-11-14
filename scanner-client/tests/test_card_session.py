import asyncio
import logging
from datetime import UTC, datetime
from urllib.parse import urlsplit

import pytest

from scanner_client.card_session import DISPATCH_JS, NAVIGATE_JS, CardSession

CONTRACT_CARD_KEYS = {
    "citizen_id",
    "first_name_th",
    "last_name_th",
    "gender",
    "birth_date",
    "birth_year_ce",
    "age",
    "address_no",
    "village_no",
    "lane",
    "road",
    "subdistrict",
    "district",
    "province",
    "scanned_at",
}

JPEG_BYTES = b"\xff\xd8\xff\xe0"  # base64 -> "/9j/4A=="


SHELTER = "https://shelter.example"
WALK_IN_URL = SHELTER + "/onsite/people/new"
LOGIN_URL = SHELTER + "/login"


class FakePage:
    """Records every evaluate attempt as (event_name, detail); True = page called preventDefault().

    url: where the tab is now. goto_lands: where goto() leaves it (default: the walk-in page).
    ack_after: failed attempts per event before the page acknowledges (None = never acknowledges).
    raise_first: the first N evaluate calls raise (navigation in progress).
    navigate_after: (n, url) - once n evaluate calls were made the SPA moves the tab to url.
    navigate_on_evaluate: url - right before the first evaluate the tab moves there (the race
        between the Python-side url check and the in-page script).
    goto_raises: goto() raises (net error / page closed).
    in_app_lands: where the in-app (SvelteKit router) navigation leaves the tab
        (default: same as goto_lands; pass the current url to emulate a router that did not move).

    evaluate() emulates the DISPATCH_JS contract: given [name, detail, origin, path] it only
    delivers (records in `delivered`) and acknowledges while its own url matches that origin+path;
    otherwise it refuses (returns False). `events` still records every attempt.
    """

    def __init__(
        self,
        url=WALK_IN_URL,
        goto_lands=WALK_IN_URL,
        ack_after=0,
        raise_first=0,
        navigate_after=None,
        navigate_on_evaluate=None,
        goto_raises=False,
        in_app_lands=None,
    ):
        self.url = url
        self.goto_lands = goto_lands
        self.ack_after = ack_after
        self.raise_first = raise_first
        self.navigate_after = navigate_after
        self.navigate_on_evaluate = navigate_on_evaluate
        self.goto_raises = goto_raises
        self.events: list[tuple[str, dict]] = []
        self.delivered: list[tuple[str, dict]] = []
        self.gotos: list[str] = []
        self.in_app_lands = in_app_lands or goto_lands
        self.in_app_navigations: list[str] = []

    async def goto(self, url):
        self.gotos.append(url)
        if self.goto_raises:
            raise RuntimeError("net::ERR_CONNECTION_REFUSED")
        self.url = self.goto_lands

    async def wait_for_url(self, url, *, wait_until, timeout):
        if not url(self.url):
            raise TimeoutError(f"Timeout {timeout}ms exceeded")

    async def evaluate(self, script, arg):
        if script == NAVIGATE_JS:
            self.in_app_navigations.append(arg)
            self.url = self.in_app_lands
            return None
        name, detail, origin, path = arg
        self.events.append((name, detail))
        calls = len(self.events)
        if calls == 1 and self.navigate_on_evaluate:
            self.url = self.navigate_on_evaluate
        # the in-page guard: location.origin / location.pathname vs the passed args
        here = urlsplit(self.url)
        guard_ok = f"{here.scheme}://{here.netloc}" == origin and here.path == path
        if guard_ok:
            self.delivered.append((name, detail))
        if self.navigate_after and calls >= self.navigate_after[0]:
            self.url = self.navigate_after[1]
        if calls <= self.raise_first:
            raise RuntimeError("Execution context was destroyed")
        if not guard_ok or self.ack_after is None:
            return False
        attempts_for_event = sum(1 for n, _ in self.events if n == name)
        return attempts_for_event > self.ack_after


class FakeClock:
    """Virtual time: sleep() advances monotonic() without waiting."""

    def __init__(self):
        self.t = 0.0

    def monotonic(self):
        return self.t

    async def sleep(self, seconds):
        self.t += seconds


def make_session(now=None, clock=None, **kwargs):
    clock = clock or FakeClock()
    return CardSession(
        shelter_url=SHELTER,
        now=now or NOW,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
        **kwargs,
    )


class FakeReader:
    """Same surface as kiosk ThaiSmartCardReader, no hardware. Card: b. 12 Apr 2535 BE.

    Failure switches: connect_ok, getter_raises, dob, photo ("ok" | "none" | "raises").
    """

    def __init__(self, connect_ok=True, getter_raises=False, dob="25350412", photo="ok"):
        self.connect_ok = connect_ok
        self.getter_raises = getter_raises
        self.dob = dob
        self.photo = photo

    def connect(self):
        return self.connect_ok

    def get_citizen_id(self):
        return "1234567890123"

    def get_thai_name_parts(self):
        if self.getter_raises:
            raise OSError("card removed")
        return ["นาย", "สมชาย", "", "ใจดี"]

    def get_date_of_birth(self):
        return self.dob

    def get_gender(self):
        return "male"

    def get_address_parts(self):
        return ["99/1", "หมู่ที่ 3", "", "ซอย 5", "", "ตำบลในเมือง", "อำเภอเมือง", "จังหวัดขอนแก่น"]

    def read_photo(self):
        if self.photo == "raises":
            raise OSError("card removed")
        if self.photo == "none":
            return None
        return JPEG_BYTES


def test_inserted_card_dispatches_reading_then_text_card_then_photo():
    page = FakePage()
    session = make_session(now=lambda: datetime(2026, 11, 11, 9, 0, tzinfo=UTC))

    asyncio.run(session.handle_card(FakeReader(), page))

    assert [name for name, _ in page.events] == [
        "scanner:card-reading",
        "scanner:card-read",
        "scanner:card-photo",
    ]
    reading, card, photo = (detail for _, detail in page.events)
    assert reading == {}
    assert set(card) == CONTRACT_CARD_KEYS
    assert card["citizen_id"] == "1234567890123"
    assert card["first_name_th"] == "สมชาย"
    assert card["last_name_th"] == "ใจดี"
    assert card["gender"] == "male"
    assert card["birth_date"] == "25350412"
    assert card["birth_year_ce"] == 1992
    assert card["age"] == 34
    assert card["address_no"] == "99/1"
    assert card["village_no"] == "3"
    assert card["lane"] == "ซอย 5"
    assert card["road"] == ""
    assert card["subdistrict"] == "ในเมือง"
    assert card["district"] == "เมือง"
    assert card["province"] == "ขอนแก่น"
    assert card["scanned_at"] == "2026-11-11T09:00:00+00:00"
    assert photo == {
        "citizen_id": "1234567890123",
        "photo_base64": "data:image/jpeg;base64,/9j/4A==",
    }


NOW = lambda: datetime(2026, 11, 11, 9, 0, tzinfo=UTC)  # noqa: E731
PRIVATE_VALUES = ("1234567890123", "สมชาย", "ใจดี", "99/1", "/9j/4A==")


def assert_logs_have_no_card_data(caplog, code):
    messages = [record.getMessage() for record in caplog.records]
    assert any(code in message for message in messages)
    for message in messages:
        for value in PRIVATE_VALUES:
            assert value not in message


@pytest.mark.parametrize(
    "reader",
    [FakeReader(connect_ok=False), FakeReader(getter_raises=True)],
    ids=["connect-returns-false", "getter-raises"],
)
def test_text_read_failure_dispatches_read_failed_and_nothing_else(reader, caplog):
    page = FakePage()
    caplog.set_level(logging.DEBUG)

    asyncio.run(make_session().handle_card(reader, page))

    assert page.events == [
        ("scanner:card-reading", {}),
        ("scanner:card-error", {"code": "READ_FAILED"}),
    ]
    assert_logs_have_no_card_data(caplog, "READ_FAILED")


@pytest.mark.parametrize("dob", ["", "-", "2535", "abcd0412"])
def test_unusable_date_of_birth_omits_year_and_age_but_is_not_a_failure(dob):
    page = FakePage()

    asyncio.run(make_session().handle_card(FakeReader(dob=dob), page))

    assert [name for name, _ in page.events] == [
        "scanner:card-reading",
        "scanner:card-read",
        "scanner:card-photo",
    ]
    card = page.events[1][1]
    assert card["birth_date"] == dob
    assert "birth_year_ce" not in card
    assert "age" not in card
    assert set(card) == CONTRACT_CARD_KEYS - {"birth_year_ce", "age"}


@pytest.mark.parametrize("photo", ["none", "raises"])
def test_photo_failure_after_card_read_dispatches_photo_failed(photo, caplog):
    page = FakePage()
    caplog.set_level(logging.DEBUG)

    asyncio.run(make_session().handle_card(FakeReader(photo=photo), page))

    assert [name for name, _ in page.events] == [
        "scanner:card-reading",
        "scanner:card-read",
        "scanner:card-error",
    ]
    assert page.events[2][1] == {"code": "PHOTO_FAILED"}
    assert_logs_have_no_card_data(caplog, "PHOTO_FAILED")


CARD_EVENTS = ["scanner:card-reading", "scanner:card-read", "scanner:card-photo"]


@pytest.mark.parametrize(
    "url",
    [WALK_IN_URL, WALK_IN_URL + "?from=scan#top"],
    ids=["exact", "query-and-fragment-ignored"],
)
def test_page_already_on_walk_in_is_not_navigated(url):
    page = FakePage(url=url)

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert page.gotos == []
    assert [name for name, _ in page.events] == CARD_EVENTS


def test_page_elsewhere_on_shelter_origin_navigates_in_app_without_a_page_reload():
    page = FakePage(url=SHELTER + "/dashboard")

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert page.in_app_navigations == ["/onsite/people/new"]
    assert page.gotos == []
    assert [name for name, _ in page.events] == CARD_EVENTS


def test_in_app_navigation_that_never_reaches_walk_in_falls_back_to_goto():
    dashboard = SHELTER + "/dashboard"
    page = FakePage(url=dashboard, in_app_lands=dashboard)

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert page.gotos == [WALK_IN_URL]
    assert [name for name, _ in page.events] == CARD_EVENTS


@pytest.mark.parametrize(
    "url",
    ["about:blank", "data:text/html,prompt", "https://evil.example/somewhere"],
    ids=["startup-blank", "url-prompt", "other-origin"],
)
def test_card_off_the_shelter_site_is_ignored_without_navigating(url):
    # e.g. a card left in the reader while the app starts: the tab stays on sign-in
    page = FakePage(url=url)

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert page.in_app_navigations == []
    assert page.gotos == []
    assert page.events == []


@pytest.mark.parametrize(
    "landed",
    [LOGIN_URL, "https://evil.example/onsite/people/new"],
    ids=["goto-redirected-to-login", "goto-stays-on-other-origin"],
)
def test_page_on_other_origin_never_receives_card_data(landed, caplog):
    page = FakePage(url="https://evil.example/onsite/people/new", goto_lands=landed)
    caplog.set_level(logging.DEBUG)

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert page.events == []
    warnings = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings
    for message in warnings:
        for value in PRIVATE_VALUES:
            assert value not in message


def test_page_redirected_to_login_after_first_event_stops_the_card():
    page = FakePage(goto_lands=LOGIN_URL, navigate_after=(1, LOGIN_URL))

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert page.gotos == []
    assert page.in_app_navigations == []
    assert [name for name, _ in page.events] == ["scanner:card-reading"]


@pytest.mark.parametrize("path", ["/login", "/admin-login", "/admin-login/", "/mfa-challenge"])
def test_card_inserted_while_signed_out_is_ignored_without_navigating(path):
    page = FakePage(url=SHELTER + path + "?redirect=x")

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert page.in_app_navigations == []
    assert page.gotos == []
    assert page.events == []


def test_auth_guard_bouncing_back_to_sign_in_navigates_only_once_per_card():
    # session expired: every route the tab is sent to lands back on /login
    page = FakePage(url=SHELTER + "/dashboard", goto_lands=LOGIN_URL, ack_after=None)
    clock = FakeClock()

    asyncio.run(make_session(clock=clock).handle_card(FakeReader(), page))

    assert page.in_app_navigations == ["/onsite/people/new"]
    assert page.gotos == [WALK_IN_URL]
    assert page.events == []


def test_tab_leaving_walk_in_mid_retry_is_sent_back_at_most_once():
    dashboard = SHELTER + "/dashboard"
    page = FakePage(ack_after=None, navigate_after=(1, dashboard))

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert page.in_app_navigations == ["/onsite/people/new"]
    assert [name for name, _ in page.events] == ["scanner:card-reading"] * 2


def test_page_redirected_to_login_while_retrying_stops_without_more_attempts():
    page = FakePage(ack_after=None, goto_lands=LOGIN_URL, navigate_after=(2, LOGIN_URL))

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert [name for name, _ in page.events] == ["scanner:card-reading"] * 2


def test_dispatch_is_repeated_until_the_page_acknowledges():
    page = FakePage(ack_after=2)

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert [name for name, _ in page.events] == [
        "scanner:card-reading",
        "scanner:card-reading",
        "scanner:card-reading",
        "scanner:card-read",
        "scanner:card-read",
        "scanner:card-read",
        "scanner:card-photo",
        "scanner:card-photo",
        "scanner:card-photo",
    ]


def test_evaluate_raising_counts_as_not_acknowledged_for_that_attempt():
    page = FakePage(raise_first=2)

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert [name for name, _ in page.events] == [
        "scanner:card-reading",
        "scanner:card-reading",
        "scanner:card-reading",
        "scanner:card-read",
        "scanner:card-photo",
    ]


def test_never_acknowledged_event_is_dropped_after_15_seconds_and_card_stops(caplog):
    page = FakePage(ack_after=None)
    clock = FakeClock()
    caplog.set_level(logging.DEBUG)

    asyncio.run(make_session(clock=clock).handle_card(FakeReader(), page))

    assert {name for name, _ in page.events} == {"scanner:card-reading"}
    assert 29 <= len(page.events) <= 31  # every 0.5 s for 15 s
    assert 14.5 <= clock.t <= 15.5
    assert any(r.levelno >= logging.WARNING for r in caplog.records)


EVIL_WALK_IN_URL = "https://evil.example/onsite/people/new"


def test_tab_navigating_to_another_origin_right_before_evaluate_never_receives_card_data():
    page = FakePage(goto_lands=LOGIN_URL, navigate_on_evaluate=EVIL_WALK_IN_URL)

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert page.delivered == []
    assert page.gotos == []
    assert [name for name, _ in page.events] == ["scanner:card-reading"]


def test_dispatch_script_refuses_unless_location_matches_expected_origin_and_path():
    assert "location.origin" in DISPATCH_JS
    assert "location.pathname" in DISPATCH_JS


def test_goto_failure_drops_the_event_with_a_warning_and_handle_card_returns(caplog):
    dashboard = SHELTER + "/dashboard"
    page = FakePage(url=dashboard, in_app_lands=dashboard, goto_raises=True)
    caplog.set_level(logging.DEBUG)

    asyncio.run(make_session().handle_card(FakeReader(), page))

    assert page.events == []
    assert page.gotos == [WALK_IN_URL]
    warnings = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings
    for message in warnings:
        for value in PRIVATE_VALUES:
            assert value not in message
