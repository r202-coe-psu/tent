import asyncio

from scanner_client.url_prompt import DEFAULT_SHELTER_ORIGIN, ask_shelter_origin


class PageClosed(Exception):
    pass


class FakeHandle:
    def __init__(self, value):
        self.value = value

    async def json_value(self):
        return self.value


class FakePromptPage:
    """Each scripted submission is what staff typed before pressing Enter."""

    def __init__(self, submissions):
        self.submissions = list(submissions)
        self.contents = []
        self.evaluations = []

    async def set_content(self, html, **kwargs):
        self.contents.append(html)

    async def evaluate(self, script, arg=None):
        self.evaluations.append((script, arg))

    async def wait_for_function(self, script, **kwargs):
        assert kwargs.get("timeout") == 0  # staff may take any time to answer
        if not self.submissions:
            raise PageClosed()
        submission = self.submissions.pop(0)
        if isinstance(submission, str):
            submission = {"value": submission, "confirmed": False}
        return FakeHandle(submission)

    def errors_shown(self):
        return [arg for script, arg in self.evaluations if "showError" in script]

    def warnings_shown(self):
        return [arg for script, arg in self.evaluations if "showWarning" in script]

    def tick_hints_shown(self):
        return sum(1 for script, _ in self.evaluations if "showTickHint" in script)


def confirmed(value):
    """Staff ticked "I checked this site" before pressing Enter."""
    return {"value": value, "confirmed": True}


def ask(page, initial=""):
    return asyncio.run(ask_shelter_origin(page, initial))


def test_shows_the_form_prefilled_with_the_last_origin():
    page = FakePromptPage([confirmed("https://last.example")])

    ask(page, "https://last.example")

    assert len(page.contents) == 1
    assert "SHELTER_URL" in page.contents[0]
    assert "https://last.example" not in page.contents[0]  # passed as data, never as markup
    assert "https://last.example" in [arg for _, arg in page.evaluations]


def test_returns_the_normalised_origin_of_a_valid_answer():
    page = FakePromptPage(["  https://Shelter.Example:443/ ", confirmed("https://shelter.example")])

    assert ask(page) == "https://shelter.example"
    assert page.errors_shown() == []


def test_an_invalid_answer_shows_an_error_and_asks_again():
    page = FakePromptPage(
        [
            "shelter.example",
            "http://example.org",
            "http://192.168.1.10",
            confirmed("http://192.168.1.10"),
        ]
    )

    assert ask(page) == "http://192.168.1.10"
    errors = page.errors_shown()
    assert len(errors) == 2
    assert all("SHELTER_URL" in e for e in errors)
    assert not any("example.org" in e for e in errors)


def test_closing_the_window_while_asking_returns_none():
    page = FakePromptPage([])

    assert ask(page) is None


def test_without_a_saved_origin_it_offers_the_psu_shelter_site():
    page = FakePromptPage(["https://shelter.psu.ac.th"])

    ask(page, "")

    assert DEFAULT_SHELTER_ORIGIN == "https://shelter.psu.ac.th"
    assert DEFAULT_SHELTER_ORIGIN in [arg for _, arg in page.evaluations]
    assert DEFAULT_SHELTER_ORIGIN in page.contents[0]  # tells staff where it goes by default


def test_the_url_box_stays_hidden_until_staff_choose_to_change_the_domain():
    page = FakePromptPage(["https://shelter.psu.ac.th"])

    ask(page, "")

    html = page.contents[0]
    assert 'id="change"' in html
    assert 'id="custom" hidden' in html


def test_the_default_site_opens_on_enter_without_a_warning():
    page = FakePromptPage(["https://shelter.psu.ac.th"])

    assert ask(page, DEFAULT_SHELTER_ORIGIN) == DEFAULT_SHELTER_ORIGIN
    assert page.warnings_shown() == []


def test_a_saved_non_default_site_is_flagged_as_soon_as_the_page_opens():
    # Someone with brief access to the PC could have saved a look-alike site in .env:
    # Enter alone must never carry staff (and every card read afterwards) there.
    page = FakePromptPage(["https://shelter-psu.example", confirmed("https://shelter-psu.example")])

    assert ask(page, "https://shelter-psu.example") == "https://shelter-psu.example"
    assert page.warnings_shown() == ["https://shelter-psu.example"]
    assert page.tick_hints_shown() == 1


def test_a_typed_non_default_site_needs_a_separate_confirmation():
    page = FakePromptPage(["https://other.example", confirmed("https://other.example")])

    assert ask(page) == "https://other.example"
    assert page.warnings_shown() == ["https://other.example"]


def test_a_confirmation_does_not_carry_over_to_a_different_site():
    # The tick was for the site shown in the warning; another typed site is warned about afresh.
    page = FakePromptPage(
        [
            "https://first.example",
            confirmed("https://second.example"),
            confirmed("https://second.example"),
        ]
    )

    assert ask(page) == "https://second.example"
    assert page.warnings_shown() == ["https://first.example", "https://second.example"]


def test_the_warning_names_the_site_as_data_never_as_markup():
    page = FakePromptPage([confirmed("https://other.example")])

    ask(page, "https://other.example")

    assert "https://other.example" not in page.contents[0]
    assert 'id="warning" hidden' in page.contents[0]
    assert 'id="confirm"' in page.contents[0]


def test_enter_without_the_tick_says_to_tick_the_box_first():
    # Chrome submits the form on Enter in the focused checkbox: without a hint the warning
    # would just stay there and look like nothing happened.
    page = FakePromptPage(
        ["https://other.example", "https://other.example", confirmed("https://other.example")]
    )

    assert ask(page) == "https://other.example"
    assert page.warnings_shown() == ["https://other.example"]
    assert page.tick_hints_shown() == 1


def test_the_tick_hint_page_names_the_box_to_tick():
    page = FakePromptPage([])

    ask(page)

    assert "window.showTickHint" in page.contents[0]
    assert "ติ๊กช่องด้านบนก่อนกด Enter" in page.contents[0]
