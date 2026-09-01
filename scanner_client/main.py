import asyncio
import logging
import os
import sys

from dotenv import dotenv_values, load_dotenv

from app.manager import ScannerClientManager

def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # Load .env first as base defaults, then allow system environment variables to override
    env_file_values = dotenv_values(".env") if os.path.exists(".env") else {}
    config = {
        **env_file_values,
        **os.environ,
    }

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

    if not config.get("DEVICE_SECRET"):
        logging.warning("⚠️  คำเตือน: ยังไม่ได้ระบุ DEVICE_SECRET ในไฟล์ .env โปรดสร้าง Secret จากหน้า Back Office")

    manager = ScannerClientManager(config)
    try:
        asyncio.run(manager.run())
    except KeyboardInterrupt:
        logging.info("Exiting Scanner Client...")
        sys.exit(0)


if __name__ == "__main__":
    main()
