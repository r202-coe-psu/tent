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

    # Load from .env if present, otherwise system env
    load_dotenv()
    config = {
        **os.environ,
        **dotenv_values(".env"),
    }

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
