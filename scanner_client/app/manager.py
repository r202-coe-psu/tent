from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import urllib.parse
from typing import Any, Dict, Optional


try:
    import httpx
except ImportError:  # pragma: no cover - production installs httpx
    httpx = None  # type: ignore[assignment]


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
        self.home_path = "/kiosk"
        self.waiting_path = "/kiosk/scanner/waiting"
        self.reading_path = "/kiosk/scanner/reading"
        self.remove_card_path = "/kiosk/scanner/remove-card"
        self.error_path = "/kiosk/scanner/error"
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
        self.home_url = self._kiosk_url(self.home_path)
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

    async def _route_kiosk_api(self, route):
        """Attach the device credential only to same-origin kiosk API requests."""
        request = route.request
        request_url = urllib.parse.urlsplit(request.url)
        configured_url = urllib.parse.urlsplit(self.tent_base_url)
        configured_origin = f"{configured_url.scheme}://{configured_url.netloc}"
        request_origin = request.headers.get("origin", "")
        allowed_paths = {
            "/api/v1/scanner/kiosk/lookup",
            "/api/v1/scanner/kiosk/check-in",
        }

        headers = dict(request.headers)
        headers.pop("x-device-id", None)
        headers.pop("x-device-secret", None)
        if (
            request.method != "POST"
            or request_origin != configured_origin
            or request_url.scheme != configured_url.scheme
            or request_url.netloc != configured_url.netloc
            or request_url.path not in allowed_paths
        ):
            await route.continue_(headers=headers)
            return

        headers["x-device-id"] = self.device_id
        headers["x-device-secret"] = self.device_secret
        await route.continue_(headers=headers)

    async def _dispatch_card_event(self, event_name: str, citizen_id: Optional[str] = None) -> None:
        if not self.page or self.page.is_closed():
            return
        if citizen_id is None:
            await self.page.evaluate(
                "eventName => window.dispatchEvent(new CustomEvent(eventName))", event_name
            )
            return
        await self.page.evaluate(
            "({ eventName, citizenId }) => window.dispatchEvent(new CustomEvent(eventName, { detail: { citizenId } }))",
            {"eventName": event_name, "citizenId": citizen_id},
        )

    async def card_reading_loop(self):
        """Wait for a card, resolve it through the kiosk flow, then wait for staff completion."""
        if not self.page:
            logger.error("Page not initialized")
            return

        logger.info("Navigating Kiosk display to the configured shelter")
        connected = False
        retry_count = 0
        while not connected and self.running:
            if self.page.is_closed():
                logger.info("Browser window closed during initial navigation.")
                return
            try:
                await self.page.goto(self.home_url, timeout=10000)
                connected = True
                logger.info("Kiosk display loaded")
            except Exception:
                retry_count += 1
                logger.warning("Waiting for Tent server (attempt %s); retrying in 3s", retry_count)
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
                if not self.reader.is_card_inserted():
                    await asyncio.sleep(self.poll_interval)
                    continue

                logger.info("Card detected; reading citizen ID")
                await self.page.goto(self.reading_url)
                await asyncio.sleep(0.6)
                try:
                    card_data = self.reader.read_all_data()
                    citizen_id = str(card_data.get("citizen_id") or "").strip()
                    if not re.fullmatch(r"\d{13}", citizen_id):
                        raise ValueError("Card did not provide a valid citizen ID")

                    await self.page.goto(self.remove_card_url)
                    await self.page.wait_for_selector(
                        '[data-kiosk-card-ready="true"]', timeout=15000
                    )
                    await self._dispatch_card_event("kiosk:smart-card-read", citizen_id)
                    logger.info("Smart-card identity sent to the shared kiosk lookup flow")
                except Exception:
                    logger.error("Smart-card read or kiosk handoff failed")
                    await self.page.goto(
                        self._kiosk_url(
                            self.error_path,
                            {"error_msg": "อ่านข้อมูลบัตรไม่สำเร็จ กรุณาลองใหม่"},
                        )
                    )

                logger.info("Waiting for card removal")
                while self.running and self.reader and self.reader.is_card_inserted():
                    await asyncio.sleep(self.poll_interval)

                if self.page.is_closed():
                    break
                if urllib.parse.urlsplit(self.page.url).path == self.remove_card_path:
                    await self._dispatch_card_event("kiosk:smart-card-removed")
                    logger.info("Card removed; waiting for staff to complete check-in")
                    while (
                        self.running
                        and not self.page.is_closed()
                        and urllib.parse.urlsplit(self.page.url).path != self.home_path
                    ):
                        await asyncio.sleep(0.5)
                else:
                    await self.page.goto(self.home_url)
            except Exception:
                logger.error("Scanner card polling loop failed")
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
            await context.route("**/api/v1/scanner/kiosk/**", self._route_kiosk_api)
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
