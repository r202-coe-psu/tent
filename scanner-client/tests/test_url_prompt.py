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
        return FakeHandle({"value": self.submissions.pop(0)})

    def errors_shown(self):
        return [arg for script, arg in self.evaluations if "showError" in script]


def ask(page, initial=""):
    return asyncio.run(ask_shelter_origin(page, initial))


def test_shows_the_form_prefilled_with_the_last_origin():
    page = FakePromptPage(["https://shelter.example"])

    ask(page, "https://last.example")

    assert len(page.contents) == 1
    assert "SHELTER_URL" in page.contents[0]
    assert "https://last.example" not in page.contents[0]  # passed as data, never as markup
    assert "https://last.example" in [arg for _, arg in page.evaluations]


def test_returns_the_normalised_origin_of_a_valid_answer():
    page = FakePromptPage(["  https://Shelter.Example:443/ "])

    assert ask(page) == "https://shelter.example"
    assert page.errors_shown() == []


def test_an_invalid_answer_shows_an_error_and_asks_again():
    page = FakePromptPage(["shelter.example", "http://example.org", "http://192.168.1.10"])

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
