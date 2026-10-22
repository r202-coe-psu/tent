import logging
import os
import sys
import time

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
    run(
        config,
        BffClient(config),
        Cups(config.printer_name, config.ppi),
        sleep=time.sleep,
        monotonic=time.monotonic,
    )


if __name__ == "__main__":
    main()
