import logging
import os
import signal
import sys
import time
from types import FrameType

from printer.api import BffClient
from printer.config import ConfigError, load_config, read_env_file
from printer.cups import Cups
from printer.runner import run


def main() -> None:
    try:
        # `.env` in the working directory for manual runs; real environment variables win.
        config = load_config({**read_env_file(".env"), **os.environ})
    except ConfigError as exc:
        print(f"printer: invalid configuration: {exc}", file=sys.stderr)
        raise SystemExit(2) from None
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per long-poll is noise
    if config.base_url.startswith("http://"):
        logging.getLogger("printer").warning(
            "TENT_BASE_URL is plain http:// - DEVICE_SECRET and labels travel unencrypted"
        )
    stopping = False

    def request_stop(signum: int, _frame: FrameType | None) -> None:
        nonlocal stopping
        stopping = True
        logging.getLogger("printer").info(
            "signal %d: finishing the current job, then exiting", signum
        )

    # systemd stops the unit with SIGTERM; without a handler it would kill a job mid-print.
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    run(
        config,
        BffClient(config),
        Cups(config.printer_name, config.ppi),
        sleep=time.sleep,
        monotonic=time.monotonic,
        should_stop=lambda: stopping,
    )


if __name__ == "__main__":
    main()
