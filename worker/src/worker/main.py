"""Sync worker entry point."""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal

from tent_model import close_db, init_db

from worker.config import load_settings
from worker.couch.bootstrap import bootstrap_all, needs_bootstrap
from worker.couch.client import CouchClient
from worker.listeners.registry import ListenerManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


async def run(*, force_bootstrap: bool, bootstrap_only: bool) -> None:
    settings = load_settings()
    await init_db(settings.mongodb_uri)
    couch = CouchClient(settings)
    manager = ListenerManager(couch)

    stop = asyncio.Event()

    def _handle_signal() -> None:
        logger.info("Shutdown requested")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_signal)

    try:
        if force_bootstrap or bootstrap_only or await needs_bootstrap():
            await bootstrap_all(couch)
        if bootstrap_only:
            logger.info("Bootstrap-only complete — exiting")
            return
        await manager.start()
        logger.info("Sync worker running — Ctrl+C to stop")
        await stop.wait()
    finally:
        await manager.stop_all()
        await couch.close()
        await close_db()


def main() -> None:
    parser = argparse.ArgumentParser(description="CouchDB → MongoDB public read-model sync worker")
    parser.add_argument(
        "--bootstrap",
        action="store_true",
        help="Force full bootstrap scan before starting continuous sync",
    )
    parser.add_argument(
        "--bootstrap-only",
        action="store_true",
        help="Run a full bootstrap scan then exit (no continuous _changes tail)",
    )
    args = parser.parse_args()
    asyncio.run(run(force_bootstrap=args.bootstrap, bootstrap_only=args.bootstrap_only))


if __name__ == "__main__":
    main()
