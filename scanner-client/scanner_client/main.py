"""Entry point: wire config, logging, Playwright and the card reader watcher (issue #1326)."""

import asyncio
import logging
import logging.handlers
import os
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from platformdirs import user_data_dir
from playwright.async_api import async_playwright

from scanner_client.card_session import CardSession
from scanner_client.config import ConfigError, Settings, load_settings
from scanner_client.reader_watch import CardReaderWatcher

APP_NAME = "ScannerClient"
LOG_FILE_NAME = "scanner-client.log"
LOG_MAX_BYTES = 1_000_000
LOG_BACKUP_COUNT = 3
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"

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
) -> None:
    """Open the browser at the shelter, watch the reader until the user closes the window."""
    stop = asyncio.Event()
    channel = (
        {} if settings.browser_channel == "chromium" else {"channel": settings.browser_channel}
    )

    async with start_playwright() as playwright:
        browser = None
        if settings.keep_login:
            context = await playwright.chromium.launch_persistent_context(
                user_data_dir=str(data_dir / "profile"), **channel, headless=False
            )
            page = context.pages[0] if context.pages else await context.new_page()
        else:
            browser = await playwright.chromium.launch(**channel, headless=False)
            browser.on("disconnected", lambda *_: stop.set())
            context = await browser.new_context()
            page = await context.new_page()
        context.on("close", lambda *_: stop.set())
        page.on("close", lambda *_: stop.set())

        session = card_session_factory(settings)

        async def handle_card(reader: Any) -> None:
            try:
                await session.handle_card(reader, page)
            except Exception as exc:  # one bad card must not stop the watcher; never log its data
                log.error("card handling failed: %s", type(exc).__name__)

        watcher_task = asyncio.create_task(watcher_factory(settings, handle_card).run(stop))
        try:
            try:
                await page.goto(f"{settings.shelter_origin}/")
            except Exception as exc:  # unreachable shelter: keep the window open, staff can reload
                log.warning("could not open the shelter page: %s", type(exc).__name__)
            await stop.wait()
        finally:
            stop.set()
            await watcher_task
            for closable in (context, browser):
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
    handlers = _configure_logging(data_dir)
    try:
        try:
            settings = load_settings(
                env_path or default_env_path(), os.environ if environ is None else environ
            )
        except ConfigError as exc:
            log.error("invalid configuration: %s", exc)
            return 2
        try:
            asyncio.run(runner(settings, data_dir=data_dir))
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
