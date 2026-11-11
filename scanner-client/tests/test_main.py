import asyncio
import logging
import logging.handlers
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from scanner_client.config import Settings
from scanner_client.main import default_env_path, main, run_app
from scanner_client.reader_watch import CardReaderWatcher


def make_settings(**overrides) -> Settings:
    values = {
        "shelter_origin": "https://shelter.example",
        "walk_in_path": "/onsite/people/new",
        "browser_channel": "msedge",
        "card_reader_name": None,
        "keep_login": False,
        "poll_interval": 0.5,
    }
    return Settings(**{**values, **overrides})


class FakeEmitter:
    def __init__(self):
        self.handlers: dict[str, list] = {}

    def on(self, event, handler):
        self.handlers.setdefault(event, []).append(handler)

    def fire(self, event):
        for handler in self.handlers.get(event, []):
            handler()


class FakePage(FakeEmitter):
    def __init__(self):
        super().__init__()
        self.gotos = []

    async def goto(self, url, **kwargs):
        self.gotos.append(url)


class FakeContext(FakeEmitter):
    def __init__(self, page):
        super().__init__()
        self.page = page
        self.pages = []
        self.closed = False

    async def new_page(self):
        return self.page

    async def close(self):
        self.closed = True


class FakeBrowser(FakeEmitter):
    def __init__(self, context):
        super().__init__()
        self.context = context
        self.new_context_calls = []
        self.closed = False

    async def new_context(self, **kwargs):
        self.new_context_calls.append(kwargs)
        return self.context

    async def close(self):
        self.closed = True


class FakeChromium:
    def __init__(self, page):
        self.page = page
        self.context = FakeContext(page)
        self.browser = FakeBrowser(self.context)
        self.launch_calls = []
        self.persistent_calls = []

    async def launch(self, **kwargs):
        self.launch_calls.append(kwargs)
        return self.browser

    async def launch_persistent_context(self, **kwargs):
        self.persistent_calls.append(kwargs)
        return self.context


class FakePlaywright:
    def __init__(self):
        self.page = FakePage()
        self.chromium = FakeChromium(self.page)

    def start(self):
        @asynccontextmanager
        async def manager():
            yield self

        return manager()


class FakeWatcher:
    def __init__(self):
        self.stop = None
        self.finished = False

    async def run(self, stop):
        self.stop = stop
        await stop.wait()
        self.finished = True


class Harness:
    """Runs run_app against fakes; `close_page_after_start` simulates closing the window."""

    def __init__(self, tmp_path, **settings):
        self.settings = make_settings(**settings)
        self.data_dir = tmp_path / "data"
        self.playwright = FakePlaywright()
        self.watcher = FakeWatcher()
        self.session_calls = []

    def run(self, close_page_after_start=True, watcher_factory=None, session_factory=None):
        page = self.playwright.page

        async def go():
            if close_page_after_start:
                asyncio.get_running_loop().call_later(0.01, page.fire, "close")
            await asyncio.wait_for(
                run_app(
                    self.settings,
                    data_dir=self.data_dir,
                    start_playwright=self.playwright.start,
                    watcher_factory=watcher_factory or (lambda settings, handle: self.watcher),
                    card_session_factory=session_factory or (lambda settings: object()),
                ),
                timeout=5,
            )

        asyncio.run(go())


def test_keep_login_false_launches_headed_channel_and_a_fresh_non_persistent_context(tmp_path):
    harness = Harness(tmp_path, keep_login=False, browser_channel="msedge")

    harness.run()

    chromium = harness.playwright.chromium
    assert chromium.launch_calls == [{"channel": "msedge", "headless": False}]
    assert chromium.browser.new_context_calls == [{}]
    assert chromium.persistent_calls == []


def test_keep_login_true_uses_a_persistent_profile_under_the_data_dir(tmp_path):
    harness = Harness(tmp_path, keep_login=True, browser_channel="chrome")

    harness.run()

    chromium = harness.playwright.chromium
    assert chromium.persistent_calls == [
        {
            "user_data_dir": str(harness.data_dir / "profile"),
            "channel": "chrome",
            "headless": False,
        }
    ]
    assert chromium.launch_calls == []


def test_chromium_channel_means_bundled_chromium_without_a_channel_kwarg(tmp_path):
    harness = Harness(tmp_path, keep_login=False, browser_channel="chromium")
    harness.run()
    assert harness.playwright.chromium.launch_calls == [{"headless": False}]

    persistent = Harness(tmp_path, keep_login=True, browser_channel="chromium")
    persistent.run()
    assert "channel" not in persistent.playwright.chromium.persistent_calls[0]


def test_opens_one_page_at_the_shelter_origin_root(tmp_path):
    harness = Harness(tmp_path, shelter_origin="https://shelter.example:8443")

    harness.run()

    assert harness.playwright.page.gotos == ["https://shelter.example:8443/"]


def test_closing_the_page_stops_the_watcher_and_returns(tmp_path):
    harness = Harness(tmp_path)

    harness.run()

    assert harness.watcher.stop.is_set()
    assert harness.watcher.finished


@pytest.mark.parametrize(
    "closer", ["context", "browser"], ids=["context closed", "browser disconnected"]
)
def test_closing_the_context_or_disconnecting_the_browser_also_ends_the_app(tmp_path, closer):
    harness = Harness(tmp_path, keep_login=(closer == "context"))
    chromium = harness.playwright.chromium

    async def go():
        target, event = (
            (chromium.context, "close")
            if closer == "context"
            else (chromium.browser, "disconnected")
        )
        asyncio.get_running_loop().call_later(0.01, target.fire, event)
        await asyncio.wait_for(
            run_app(
                harness.settings,
                data_dir=harness.data_dir,
                start_playwright=harness.playwright.start,
                watcher_factory=lambda settings, handle: harness.watcher,
                card_session_factory=lambda settings: object(),
            ),
            timeout=5,
        )

    asyncio.run(go())

    assert harness.watcher.finished


class ScriptedReader:
    """Reports the scripted insert states; once drained it closes the page to end the app."""

    def __init__(self, script, page):
        self._script = list(script)
        self._page = page

    def is_card_inserted(self):
        inserted = self._script.pop(0)
        if not self._script:
            self._page.fire("close")
        return inserted

    def close(self):
        pass


class FlakySession:
    def __init__(self, error):
        self.error = error
        self.calls = 0

    async def handle_card(self, reader, page):
        self.calls += 1
        if self.calls == 1:
            raise self.error


def test_an_error_while_handling_one_card_is_logged_by_type_and_the_next_card_still_works(
    tmp_path, caplog
):
    harness = Harness(tmp_path)
    session = FlakySession(RuntimeError("citizen 1234567890123"))
    reader = ScriptedReader([True, False, True, True], harness.playwright.page)

    def watcher_factory(settings, handle):
        async def no_sleep(seconds):
            await asyncio.sleep(0)

        return CardReaderWatcher(
            list_reader_names=lambda: ["Generic Smart Card Reader 0"],
            open_reader=lambda index: reader,
            handle_card=handle,
            poll_interval=0,
            sleep=no_sleep,
        )

    with caplog.at_level(logging.INFO):
        harness.run(
            close_page_after_start=False,
            watcher_factory=watcher_factory,
            session_factory=lambda settings: session,
        )

    assert session.calls == 2
    assert "RuntimeError" in caplog.text
    assert "1234567890123" not in caplog.text


VALID_ENV = "SHELTER_URL=https://shelter.example\n"


class RecordingRunner:
    def __init__(self, error=None):
        self.calls = []
        self.error = error
        self.handlers = []

    async def __call__(self, settings, *, data_dir):
        self.calls.append((settings, data_dir))
        self.handlers = list(logging.getLogger().handlers)
        if self.error:
            raise self.error


def test_invalid_config_is_logged_and_exits_non_zero_without_opening_the_browser(tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text("SHELTER_URL=http://shelter.example\n")
    runner = RecordingRunner()

    code = main(env_path=env_path, environ={}, data_dir=tmp_path / "data", runner=runner)

    assert code != 0
    assert runner.calls == []
    log_file = tmp_path / "data" / "logs" / "scanner-client.log"
    assert "SHELTER_URL must use https unless the host is loopback" in log_file.read_text()


def test_valid_config_runs_the_app_logs_to_a_rotating_file_and_exits_zero(tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text(VALID_ENV)
    runner = RecordingRunner()

    code = main(env_path=env_path, environ={}, data_dir=tmp_path / "data", runner=runner)

    assert code == 0
    [(settings, data_dir)] = runner.calls
    assert settings.shelter_origin == "https://shelter.example"
    assert data_dir == tmp_path / "data"
    rotating = [h for h in runner.handlers if isinstance(h, logging.handlers.RotatingFileHandler)]
    assert [(h.maxBytes, h.backupCount) for h in rotating] == [(1_000_000, 3)]
    assert Path(rotating[0].baseFilename) == tmp_path / "data" / "logs" / "scanner-client.log"


def test_an_unexpected_crash_is_logged_by_type_only_and_exits_non_zero(tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text(VALID_ENV)
    runner = RecordingRunner(error=RuntimeError("secret-detail"))

    code = main(env_path=env_path, environ={}, data_dir=tmp_path / "data", runner=runner)

    assert code != 0
    log_text = (tmp_path / "data" / "logs" / "scanner-client.log").read_text()
    assert "RuntimeError" in log_text
    assert "secret-detail" not in log_text


def test_env_file_sits_next_to_the_exe_when_frozen_else_next_to_the_package(tmp_path):
    exe = tmp_path / "dist" / "scanner-client.exe"

    assert default_env_path(frozen=True, executable=str(exe)) == tmp_path / "dist" / ".env"
    package_parent = Path(__file__).resolve().parent.parent
    assert default_env_path(frozen=False, executable="/usr/bin/python") == package_parent / ".env"
