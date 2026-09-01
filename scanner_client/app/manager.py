import asyncio
import logging
import urllib.parse
from typing import Any, Dict, Optional, Tuple


import httpx
from playwright.async_api import async_playwright, BrowserContext, Page

from app.scard import ThaiSmartCardReader

logger = logging.getLogger(__name__)


class ScannerClientManager:
    """Manages Smart Card Reader hardware polling and Playwright Kiosk display"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.tent_base_url = config.get("TENT_BASE_URL", "http://localhost:5173").rstrip("/")
        self.device_id = config.get("DEVICE_ID", "SCAN-01")
        self.device_secret = config.get("DEVICE_SECRET", "")
        self.browser_type = config.get("BROWSER", "chromium").lower()
        self.executable_path = config.get("BROWSER_EXECUTABLE_PATH") or None
        self.is_debug = str(config.get("DEBUG", "true")).lower() in ("true", "1", "yes")
        self.is_headless = str(config.get("HEADLESS", "false")).lower() in ("true", "1", "yes")
        self.poll_interval = float(config.get("POLL_INTERVAL", "0.5"))
        self.window_width = int(config.get("WINDOW_WIDTH", "540"))
        self.window_height = int(config.get("WINDOW_HEIGHT", "960"))

        # Kiosk Routes on Tent Server
        self.waiting_url = f"{self.tent_base_url}/kiosk/scanner/waiting"
        self.reading_url = f"{self.tent_base_url}/kiosk/scanner/reading"
        self.remove_card_url = f"{self.tent_base_url}/kiosk/scanner/remove-card"
        self.error_url = f"{self.tent_base_url}/kiosk/scanner/error"
        self.inbound_api_url = f"{self.tent_base_url}/api/v1/scanner/draft"

        self.reader: Optional[ThaiSmartCardReader] = None
        self.page: Optional[Page] = None
        self.context: Optional[BrowserContext] = None
        self.running = True

    async def init_reader(self) -> bool:
        """Attempt to initialize the Smart Card Reader driver"""
        while self.running:
            try:
                self.reader = ThaiSmartCardReader()
                logger.info("Smart Card Reader ready.")
                return True
            except Exception as e:
                logger.warning(f"Waiting for Smart Card Reader hardware: {e}")
                self.reader = None
                await asyncio.sleep(2.0)
        return False

    async def submit_draft(self, card_data: Dict[str, Any]) -> Tuple[bool, str, Optional[str]]:

        """Send scanned card payload to Tent Inbound API"""
        headers = {
            "Content-Type": "application/json",
            "X-Device-Id": self.device_id,
            "X-Device-Secret": self.device_secret,
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.post(self.inbound_api_url, json={"card_data": card_data}, headers=headers)
                resp_json = response.json() if response.content else {}

                if response.status_code == 200:
                    msg = resp_json.get("message", "อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล")
                    status = resp_json.get("status", "created_pre_registered")
                    logger.info(f"Successfully processed scan draft: Evacuee ID={resp_json.get('evacuee_id')}, Status={status}")
                    return True, msg, status
                elif response.status_code == 409:
                    err_msg = resp_json.get("error") or resp_json.get("message") or "มีข้อมูลการสแกนบัตรนี้รออยู่แล้ว กรุณาไปพบเจ้าหน้าที่"
                    status = resp_json.get("status", "already_registered")
                    logger.warning(f"Inbound API 409 Notice: {err_msg}")
                    return False, err_msg, status
                else:
                    err_msg = resp_json.get("error") or "ไม่สามารถบันทึกข้อมูลเข้าสู่ระบบส่วนกลางได้"
                    logger.error(f"Inbound API error [{response.status_code}]: {response.text}")
                    return False, err_msg, None
            except Exception as e:
                logger.error(f"Failed to connect to Tent API ({self.inbound_api_url}): {e}")
                return False, f"เชื่อมต่อระบบส่วนกลางไม่สำเร็จ ({e})", None

    async def card_reading_loop(self):
        """Main lifecycle loop: Waiting -> Reading -> Inbound Submit -> Remove Card -> Waiting"""
        if not self.page:
            logger.error("Page not initialized")
            return

        logger.info(f"Navigating Kiosk display to: {self.waiting_url}")
        # Startup connection retry loop in case network or server is still booting up
        connected = False
        retry_count = 0
        while not connected and self.running:
            if self.page.is_closed():
                logger.info("Browser window closed during initial navigation.")
                return
            try:
                await self.page.goto(self.waiting_url, timeout=10000)
                connected = True
                logger.info(f"Successfully loaded Kiosk display: {self.waiting_url}")
            except Exception as e:
                retry_count += 1
                logger.warning(f"Waiting for Tent server at {self.waiting_url} (attempt {retry_count}): {e}. Retrying in 3s...")
                await asyncio.sleep(3.0)

        await self.init_reader()

        while self.running:
            if self.page.is_closed():
                logger.info("Browser window closed. Exiting loop.")
                break

            if not self.reader:
                await self.init_reader()
                await asyncio.sleep(1.0)
                continue

            try:
                # Check if card is inserted
                if not self.reader.is_card_inserted():
                    await asyncio.sleep(self.poll_interval)
                    continue

                logger.info("Card detected! Reading data...")
                # 1. Show Reading / PDPA screen
                await self.page.goto(self.reading_url)
                await asyncio.sleep(0.6)

                # 2. Read APDU data from card
                try:
                    card_data = self.reader.read_all_data()
                    logger.info(f"Read card: CID={card_data.get('citizen_id')}, Name={card_data.get('full_name_th')}")

                    # 3. Submit to Tent Server
                    success, msg, status = await self.submit_draft(card_data)
                    if success:
                        # 4. Show Remove Card screen with message (Green success)
                        encoded_msg = urllib.parse.quote(msg)
                        await self.page.goto(f"{self.remove_card_url}?message={encoded_msg}")
                    elif status in ("already_pre_registered", "duplicate_draft", "updated_pre_registered"):
                        # 4b. Show Emerald screen for repeat / pre-registered scans so user feels successful
                        encoded_msg = urllib.parse.quote(msg)
                        await self.page.goto(f"{self.remove_card_url}?status={status}&message={encoded_msg}")
                    elif status is not None:
                        # 4c. Show Yellow Warning screen for other notices (e.g. checked out, temporary leave)
                        encoded_msg = urllib.parse.quote(msg)
                        await self.page.goto(f"{self.remove_card_url}?type=warning&message={encoded_msg}")
                    else:
                        # 4d. Show Red Error screen for HTTP 500 / server network failures
                        error_msg = urllib.parse.quote(msg)
                        await self.page.goto(f"{self.error_url}?error_msg={error_msg}")

                except Exception as read_err:
                    logger.error(f"Error reading smart card data: {read_err}")
                    error_msg = urllib.parse.quote(str(read_err))
                    await self.page.goto(f"{self.error_url}?error_msg={error_msg}")


                # 5. Wait for card removal
                logger.info("Waiting for card to be removed...")
                while self.reader and self.reader.is_card_inserted():
                    await asyncio.sleep(self.poll_interval)

                logger.info("Card removed. Returning to waiting screen.")
                await self.page.goto(self.waiting_url)

            except Exception as loop_err:
                logger.error(f"Polling loop exception: {loop_err}")
                await asyncio.sleep(1.0)

    def _build_browser_args(self) -> list:
        # Standard kiosk arguments optimized for Linux / Raspberry Pi OS (Labwc, Wayfire, X11)
        base_args = [
            "--disable-infobars",
            "--disable-session-crashed-bubble",
            "--disable-features=Translate,OverscrollHistoryNavigation",
            "--no-first-run",
            "--noerrdialogs",
            "--disable-pinch",
            "--overscroll-history-navigation=0",
            "--check-for-update-interval=31536000",
            "--ozone-platform-hint=auto",   # Essential for Wayland (Labwc / Wayfire) on Raspberry Pi OS
            "--disable-dev-shm-usage",     # Prevent shared memory crashes on Raspberry Pi ARM64
            "--no-sandbox",                # Prevent sandbox privilege crashes in kiosk environments
            "--touch-events=enabled",      # Enable touch screen event support
        ]
        if not self.is_debug:
            # Fullscreen Kiosk Mode (match ghosa: kiosk + start-maximized without conflicting start-fullscreen)
            args = base_args + [
                "--kiosk",
                "--start-maximized",
            ]
        else:
            # Windowed Debug Mode (e.g. for desktop development)
            args = base_args + [
                f"--window-size={self.window_width},{self.window_height}",
                "--start-maximized",
            ]
        return args

    async def run(self):
        """Launch Playwright browser context and start card reader loop"""
        mode_str = f"Windowed ({self.window_width}x{self.window_height})" if self.is_debug else "Fullscreen Kiosk"
        logger.info(f"Starting Scanner Client Manager (Device: {self.device_id}, Mode: {mode_str})...")
        args = self._build_browser_args()

        async with async_playwright() as p:
            browser_launcher = getattr(p, self.browser_type, None)
            if browser_launcher is None:
                logger.error(f"Unsupported browser type: {self.browser_type}, falling back to chromium")
                browser_launcher = p.chromium

            context = await browser_launcher.launch_persistent_context(
                user_data_dir="/tmp/scanner_client_browser_profile",
                headless=self.is_headless,
                executable_path=self.executable_path,
                args=args,
                ignore_default_args=["--enable-automation"],
                no_viewport=True,
            )

            self.context = context
            self.page = context.pages[0] if context.pages else await context.new_page()

            # Attach event listeners to catch crashes or closures
            context.on("close", lambda: logger.warning("Browser context closed."))
            self.page.on("crash", lambda p: logger.error("💥 Browser page crashed!"))
            self.page.on("pageerror", lambda err: logger.error(f"💥 Browser runtime error: {err}"))
            self.page.on("close", lambda p: logger.info("Browser page was closed."))

            try:
                await self.card_reading_loop()
            except Exception as e:
                logger.error(f"Scanner manager error: {e}")
            finally:
                await context.close()
