from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import urllib.parse
from typing import Any, Dict, Optional, Tuple


try:
    import httpx
except ImportError:  # pragma: no cover - production installs httpx
    httpx = None  # type: ignore[assignment]

if httpx is not None:
    HttpxRequestError = httpx.RequestError
else:  # pragma: no cover - production installs httpx
    class HttpxRequestError(Exception):
        pass

try:
    from playwright.async_api import async_playwright, BrowserContext, Page
except ImportError:  # pragma: no cover - production installs playwright
    async_playwright = None  # type: ignore[assignment]
    BrowserContext = Any  # type: ignore[misc,assignment]
    Page = Any  # type: ignore[misc,assignment]

try:
    from app.scard import ThaiSmartCardReader
except ImportError:  # pragma: no cover - tests can exercise bootstrap without a card reader
    ThaiSmartCardReader = Any  # type: ignore[misc,assignment]

logger = logging.getLogger(__name__)


class BootstrapError(RuntimeError):
    """Base class for safe scanner bootstrap failures."""


class BootstrapAuthError(BootstrapError):
    pass


class BootstrapUnavailableError(BootstrapError):
    pass


def safe_server_message(value: Any, fallback: str) -> str:
    """Keep upstream card messages useful without propagating credentials or CID values."""

    if not isinstance(value, str):
        return fallback
    message = re.sub(r"sk_scan_[A-Za-z0-9_-]+", "[redacted]", value)
    message = re.sub(r"\b\d{13}\b", "[redacted]", message)
    return message[:300]


class ScannerClientManager:
    """Manages Smart Card Reader hardware polling and Playwright Kiosk display"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.tent_base_url = str(config["TENT_BASE_URL"]).rstrip("/")
        self.device_id = str(config["DEVICE_ID"])
        self.device_secret = str(config["DEVICE_SECRET"])
        self.browser_type = config.get("BROWSER", "chromium").lower()
        self.executable_path = self._resolve_executable_path(config.get("BROWSER_EXECUTABLE_PATH"))
        self.is_debug = str(config.get("DEBUG", "true")).lower() in ("true", "1", "yes")
        self.is_headless = str(config.get("HEADLESS", "false")).lower() in ("true", "1", "yes")
        self.poll_interval = float(config.get("POLL_INTERVAL", "0.5"))
        self.window_width = int(config.get("WINDOW_WIDTH", "540"))
        self.window_height = int(config.get("WINDOW_HEIGHT", "960"))
        self.device_scale_factor = str(config.get("DEVICE_SCALE_FACTOR") or config.get("SCALE_FACTOR") or config.get("ZOOM") or "").strip() or None
        self.bootstrap_attempts = max(1, min(int(config.get("BOOTSTRAP_ATTEMPTS", "4")), 5))
        self.bootstrap_backoff = max(0.25, min(float(config.get("BOOTSTRAP_BACKOFF", "1.0")), 8.0))

        self.shelter_code = ""
        self.shelter_name = ""
        self.station_name = ""
        self.device_name = ""

        # Kiosk Routes on Tent Server
        self.waiting_path = "/kiosk/scanner/waiting"
        self.reading_path = "/kiosk/scanner/reading"
        self.remove_card_path = "/kiosk/scanner/remove-card"
        self.error_path = "/kiosk/scanner/error"
        self.inbound_api_url = f"{self.tent_base_url}/api/v1/scanner/draft"
        self.bootstrap_api_url = f"{self.tent_base_url}/api/v1/scanner/bootstrap"
        self._refresh_kiosk_urls()

        self.reader: Optional[ThaiSmartCardReader] = None
        self.page: Optional[Page] = None
        self.context: Optional[BrowserContext] = None
        self.running = True

    def _kiosk_url(self, path: str, extra_params: Optional[Dict[str, str]] = None) -> str:
        params = {
            "shelter_code": self.shelter_code,
            "shelter_name": self.shelter_name,
            "station_name": self.station_name,
            "device_name": self.device_name,
        }
        if extra_params:
            params.update(extra_params)
        query = urllib.parse.urlencode({key: value for key, value in params.items() if value})
        return f"{self.tent_base_url}{path}" + (f"?{query}" if query else "")

    def _refresh_kiosk_urls(self) -> None:
        self.waiting_url = self._kiosk_url(self.waiting_path)
        self.reading_url = self._kiosk_url(self.reading_path)
        self.remove_card_url = self._kiosk_url(self.remove_card_path)
        self.error_url = self._kiosk_url(self.error_path)

    async def bootstrap(self) -> Dict[str, Any]:
        """Authenticate this machine before any browser or card-reader startup."""

        if httpx is None:
            raise BootstrapUnavailableError()

        headers = {
            "Content-Type": "application/json",
            "X-Device-Id": self.device_id,
            "X-Device-Secret": self.device_secret,
        }

        for attempt in range(1, self.bootstrap_attempts + 1):
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(
                        self.bootstrap_api_url,
                        json={"client_version": str(self.config.get("CLIENT_VERSION", "scanner-client"))},
                        headers=headers,
                    )
            except httpx.RequestError:
                if attempt == self.bootstrap_attempts:
                    raise BootstrapUnavailableError()
                logger.warning("Scanner bootstrap network unavailable (attempt %s/%s)", attempt, self.bootstrap_attempts)
                await asyncio.sleep(min(self.bootstrap_backoff * (2 ** (attempt - 1)), 8.0))
                continue

            if response.status_code == 200:
                payload = response.json() if response.content else {}
                device = payload.get("device") if isinstance(payload, dict) else None
                shelter_code = device.get("shelter_code") if isinstance(device, dict) else None
                if (
                    not isinstance(device, dict)
                    or device.get("device_id") != self.device_id
                    or not isinstance(shelter_code, str)
                    or not shelter_code.strip()
                ):
                    raise BootstrapError("Scanner bootstrap returned an invalid device response")

                self.shelter_code = shelter_code.strip()
                self.shelter_name = str(device.get("shelter_name") or self.shelter_code).strip()
                self.station_name = str(device.get("station_name") or "").strip()
                self.device_name = str(device.get("name") or "Kiosk").strip()
                self._refresh_kiosk_urls()
                logger.info("Scanner bootstrap succeeded for device %s", self.device_id)
                return payload

            if response.status_code == 401:
                raise BootstrapAuthError()

            if response.status_code == 503 and attempt < self.bootstrap_attempts:
                logger.warning("Scanner bootstrap service unavailable (attempt %s/%s)", attempt, self.bootstrap_attempts)
                await asyncio.sleep(min(self.bootstrap_backoff * (2 ** (attempt - 1)), 8.0))
                continue

            if response.status_code == 503:
                raise BootstrapUnavailableError()
            raise BootstrapError("Scanner bootstrap was rejected")

        raise BootstrapUnavailableError()

    def _resolve_executable_path(self, raw_path: Optional[str]) -> Optional[str]:
        """Validate or auto-detect working browser executable path"""
        if raw_path and os.path.exists(raw_path):
            return raw_path

        if raw_path:
            logger.warning(f"⚠️  Specified BROWSER_EXECUTABLE_PATH not found: {raw_path}")

        # Auto-detect common Linux Chromium paths
        candidates = [
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            shutil.which("chromium"),
            shutil.which("chromium-browser"),
            "/snap/bin/chromium",
        ]
        for candidate in candidates:
            if candidate and os.path.exists(candidate):
                logger.info(f"🌐 Auto-detected system browser executable at: {candidate}")
                return candidate

        logger.info("ℹ️  No system Chromium binary detected. Falling back to Playwright bundled browser.")
        return None

    async def init_reader(self) -> bool:
        """Attempt to initialize the Smart Card Reader driver"""
        while self.running:
            try:
                self.reader = ThaiSmartCardReader()
                logger.info("Smart Card Reader ready.")
                return True
            except Exception as e:
                del e
                logger.warning("Waiting for Smart Card Reader hardware")
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
                    msg = safe_server_message(
                        resp_json.get("message"),
                        "อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล",
                    )
                    status = resp_json.get("status", "created_pre_registered")
                    logger.info("Successfully processed scan draft (status=%s)", status)
                    return True, msg, status
                elif response.status_code == 409:
                    err_msg = safe_server_message(
                        resp_json.get("error") or resp_json.get("message"),
                        "มีข้อมูลการสแกนบัตรนี้รออยู่แล้ว กรุณาไปพบเจ้าหน้าที่",
                    )
                    status = resp_json.get("status", "already_registered")
                    logger.warning("Inbound API reported an existing scan (status=%s)", status)
                    return False, err_msg, status
                else:
                    err_msg = resp_json.get("error") or "ไม่สามารถบันทึกข้อมูลเข้าสู่ระบบส่วนกลางได้"
                    if response.status_code == 401:
                        err_msg = "เครื่องสแกนไม่ได้รับอนุญาตให้ส่งข้อมูล"
                    elif response.status_code == 503:
                        err_msg = "บริการยืนยันตัวตนของเครื่องสแกนไม่พร้อมใช้งาน"
                    elif not isinstance(err_msg, str):
                        err_msg = "ไม่สามารถบันทึกข้อมูลเข้าสู่ระบบส่วนกลางได้"
                    logger.error("Inbound API rejected scanner draft (status=%s)", response.status_code)
                    return False, err_msg, None
            except (HttpxRequestError, ValueError):
                logger.error("Failed to connect to Tent API")
                return False, "เชื่อมต่อระบบส่วนกลางไม่สำเร็จ", None
            except Exception:
                logger.error("Scanner draft request failed")
                return False, "ไม่สามารถบันทึกข้อมูลเข้าสู่ระบบส่วนกลางได้", None

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
                    logger.info("Smart Card data read successfully")

                    # 3. Submit to Tent Server
                    success, msg, status = await self.submit_draft(card_data)
                    if success:
                        # 4. Show Remove Card screen with message (Green success)
                        await self.page.goto(
                            self._kiosk_url(self.remove_card_path, {"message": msg})
                        )
                    elif status is not None:
                        # 4b. Show Yellow Warning screen for existing records / notices (e.g. repeat scans, checked out, temporary leave)
                        await self.page.goto(
                            self._kiosk_url(
                                self.remove_card_path,
                                {"type": "warning", "status": status, "message": msg},
                            )
                        )
                    else:
                        # 4d. Show Red Error screen for HTTP 500 / server network failures
                        await self.page.goto(self._kiosk_url(self.error_path, {"error_msg": msg}))

                except Exception as read_err:
                    del read_err
                    logger.error("Error reading smart card data")
                    await self.page.goto(
                        self._kiosk_url(
                            self.error_path,
                            {"error_msg": "อ่านข้อมูลบัตรไม่สำเร็จ กรุณาลองใหม่"},
                        )
                    )


                # 5. Wait for card removal
                logger.info("Waiting for card to be removed...")
                while self.reader and self.reader.is_card_inserted():
                    await asyncio.sleep(self.poll_interval)

                logger.info("Card removed. Returning to waiting screen.")
                await self.page.goto(self.waiting_url)

            except Exception as loop_err:
                del loop_err
                logger.error("Polling loop exception")
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

        if self.device_scale_factor:
            base_args.extend([
                "--high-dpi-support=1",
                f"--force-device-scale-factor={self.device_scale_factor}",
            ])
            logger.info(f"🔍 Applying browser scale factor: {self.device_scale_factor}")

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
        await self.bootstrap()
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
            self.page.on("pageerror", lambda _err: logger.error("💥 Browser runtime error"))
            self.page.on("close", lambda p: logger.info("Browser page was closed."))

            try:
                await self.card_reading_loop()
            except Exception:
                logger.error("Scanner manager error")
            finally:
                await context.close()
