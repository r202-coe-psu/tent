import asyncio
import logging
import os
import sys

from app.config import ScannerConfigError, load_and_validate_config
from app.manager import (
    BootstrapAuthError,
    BootstrapUnavailableError,
    ScannerClientManager,
)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    try:
        config = load_and_validate_config(".env")
    except ScannerConfigError as error:
        logging.error("Scanner configuration invalid: %s", error)
        return 78

    # Support CLI flags to explicitly force mode
    if "--kiosk" in sys.argv:
        config["DEBUG"] = "false"
    elif "--windowed" in sys.argv or "--debug" in sys.argv:
        config["DEBUG"] = "true"


    # Ensure display environment variable is set for Linux headed mode (e.g. when launching via SSH)
    if sys.platform.startswith("linux"):
        if "DISPLAY" not in os.environ and "WAYLAND_DISPLAY" not in os.environ:
            display_val = config.get("DISPLAY", ":0")
            os.environ["DISPLAY"] = display_val
            logging.info(f"Setting default DISPLAY={display_val} for headed browser on Linux")
        if "XDG_RUNTIME_DIR" not in os.environ:
            uid = os.getuid()
            if os.path.exists(f"/run/user/{uid}"):
                os.environ["XDG_RUNTIME_DIR"] = f"/run/user/{uid}"

    manager = ScannerClientManager(config)
    try:
        asyncio.run(manager.run())
    except KeyboardInterrupt:
        logging.info("Exiting Scanner Client...")
        return 0
    except BootstrapAuthError:
        logging.error("Scanner bootstrap rejected; check DEVICE_ID and DEVICE_SECRET")
        return 79
    except BootstrapUnavailableError:
        logging.error("Scanner bootstrap unavailable after bounded retries")
        return 75
    except Exception:
        logging.error("Scanner client stopped before operational startup")
        return 75

    return 0


if __name__ == "__main__":
    sys.exit(main())
