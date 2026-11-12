"""Entry point: wire config, logging, Playwright and the card reader watcher (issue #1326)."""

import asyncio
import logging
import logging.handlers
import os
import sys
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import replace
from pathlib import Path
from typing import Any

from platformdirs import user_data_dir
from playwright.async_api import async_playwright

from scanner_client.card_session import CardSession
from scanner_client.config import ConfigError, Settings, load_settings, save_shelter_url
from scanner_client.reader_watch import CardReaderWatcher
from scanner_client.url_prompt import ask_shelter_origin

APP_NAME = "ScannerClient"
LOG_FILE_NAME = "scanner-client.log"
LOG_MAX_BYTES = 1_000_000
LOG_BACKUP_COUNT = 3
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
# Follow the real window size (Playwright pins a 1280x720 viewport by default); open fullscreen
# like F11 (staff press F11 to get the window back, Alt+F4 closes it).
WINDOW_ARGS = ["--start-fullscreen"]

log = logging.getLogger(__name__)


def default_env_path(frozen: bool | None = None, executable: str | None = None) -> Path:
    """`.env` next to the .exe when frozen (PyInstaller), else in scanner-client/."""
    if frozen is None:
        frozen = bool(getattr(sys, "frozen", False))
    if frozen:
        return Path(executable or sys.executable).parent / ".env"
    return Path(__file__).resolve().parent.parent / ".env"


def default_data_dir() -> Path:
    # appauthor=False: Windows gets %LocalAppData%\ScannerClient, not ...\<author>\ScannerClient
    return Path(user_data_dir(APP_NAME, appauthor=False))


def _configure_logging(data_dir: Path) -> list[logging.Handler]:
    log_dir = data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    file_handler = logging.handlers.RotatingFileHandler(
        log_dir / LOG_FILE_NAME,
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    handlers: list[logging.Handler] = [file_handler, logging.StreamHandler()]
    root = logging.getLogger()
    for handler in handlers:
        handler.setFormatter(logging.Formatter(LOG_FORMAT))
        root.addHandler(handler)
    root.setLevel(logging.INFO)
    return handlers


def _default_watcher_factory(settings: Settings, handle_card: Callable[[Any], Any]) -> Any:
    from app.scard import ThaiSmartCardReader  # reused from the kiosk, not copied

    def list_reader_names() -> list[str]:
        from smartcard.System import readers  # lazy: pyscard needs pcsc at import time

        return [str(reader) for reader in readers()]

    return CardReaderWatcher(
        list_reader_names=list_reader_names,
        open_reader=lambda index: ThaiSmartCardReader(reader_index=index),
        handle_card=handle_card,
        preferred_name=settings.card_reader_name,
        poll_interval=settings.poll_interval,
    )


def _default_card_session_factory(settings: Settings) -> Any:
    return CardSession(settings.shelter_origin, settings.walk_in_path)


async def run_app(
    settings: Settings,
    *,
    data_dir: Path,
    start_playwright: Callable[[], Any] = async_playwright,
    watcher_factory: Callable[[Settings, Callable[[Any], Any]], Any] = _default_watcher_factory,
    card_session_factory: Callable[[Settings], Any] = _default_card_session_factory,
    ask_origin: Callable[[Any, str], Awaitable[str | None]] | None = None,
    on_origin_chosen: Callable[[str], None] = lambda origin: None,
) -> None:
    """Open the browser at START_PATH, watch the reader until the user closes the window.

    With `ask_origin`, the window first asks which shelter to open (prefilled with
    settings.shelter_origin); the answer replaces it and goes to `on_origin_chosen`.
    """
    stop = asyncio.Event()
    channel = (
        {} if settings.browser_channel == "chromium" else {"channel": settings.browser_channel}
    )

    async with start_playwright() as playwright:
        browser = None
        if settings.keep_login:
            context = await playwright.chromium.launch_persistent_context(
                user_data_dir=str(data_dir / "profile"),
                **channel,
                headless=False,
                args=WINDOW_ARGS,
                no_viewport=True,
            )
            page = context.pages[0] if context.pages else await context.new_page()
        else:
            browser = await playwright.chromium.launch(**channel, headless=False, args=WINDOW_ARGS)
            browser.on("disconnected", lambda *_: stop.set())
            context = await browser.new_context(no_viewport=True)
            page = await context.new_page()
        context.on("close", lambda *_: stop.set())
        page.on("close", lambda *_: stop.set())

        if ask_origin is not None:
            origin = await _until_stopped(ask_origin(page, settings.shelter_origin), stop)
            if origin is None:  # window closed before an answer
                await _close_all(context, browser)
                return
            settings = replace(settings, shelter_origin=origin)
            on_origin_chosen(origin)

        session = card_session_factory(settings)

        async def handle_card(reader: Any) -> None:
            try:
                await session.handle_card(reader, page)
            except Exception as exc:  # one bad card must not stop the watcher; never log its data
                log.error("card handling failed: %s", type(exc).__name__)

        watcher_task = asyncio.create_task(watcher_factory(settings, handle_card).run(stop))
        try:
            try:
                await page.goto(f"{settings.shelter_origin}{settings.start_path}")
            except Exception as exc:  # unreachable shelter: keep the window open, staff can reload
                log.warning("could not open the shelter page: %s", type(exc).__name__)
            await stop.wait()
        finally:
            stop.set()
            await watcher_task
            await _close_all(context, browser)


async def _until_stopped(asking: Awaitable[str | None], stop: asyncio.Event) -> str | None:
    """The prompt's answer, or None as soon as the window is closed."""
    ask_task = asyncio.ensure_future(asking)
    stop_task = asyncio.create_task(stop.wait())
    await asyncio.wait({ask_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
    stop_task.cancel()
    if not ask_task.done():
        ask_task.cancel()
        return None
    return ask_task.result()


async def _close_all(*closables: Any) -> None:
    for closable in closables:
        if closable is not None:
            try:
                await closable.close()
            except Exception:  # already closed by the user
                pass


def main(
    *,
    env_path: Path | None = None,
    environ: Mapping[str, str] | None = None,
    data_dir: Path | None = None,
    runner: Callable[..., Any] = run_app,
) -> int:
    data_dir = data_dir or default_data_dir()
    env_path = env_path or default_env_path()
    handlers = _configure_logging(data_dir)
    try:
        try:
            settings = load_settings(
                env_path, os.environ if environ is None else environ, require_shelter_url=False
            )
        except ConfigError as exc:
            log.error("invalid configuration: %s", exc)
            return 2

        def remember(origin: str) -> None:
            try:
                save_shelter_url(env_path, origin)
            except OSError as exc:  # read-only folder: still run, just ask again next time
                log.warning("could not save SHELTER_URL: %s", type(exc).__name__)

        try:
            asyncio.run(
                runner(
                    settings,
                    data_dir=data_dir,
                    ask_origin=ask_shelter_origin,
                    on_origin_chosen=remember,
                )
            )
        except Exception as exc:
            log.error("scanner client stopped: %s", type(exc).__name__)
            return 1
        return 0
    finally:
        for handler in handlers:
            logging.getLogger().removeHandler(handler)
            handler.close()


if __name__ == "__main__":
    sys.exit(main())
