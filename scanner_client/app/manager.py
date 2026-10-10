from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import re
import select
import shutil
import time
import traceback
import urllib.parse
from pathlib import Path
from typing import Any, Dict, Optional

from app.config import (
    DEFAULT_CARD_READER_USB_ID,
    DEFAULT_PRINTER_WIDTH_DOTS,
    DEFAULT_QR_READER_GAP_MS,
    FACE_CHECK_FLOWS,
)
from app.rfpro import RfproError, RfproThaiCardReader
from app.scard import ReaderLostError, ThaiSmartCardReader

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

logger = logging.getLogger(__name__)

# Chromium managed policies are read from /etc/chromium/policies by the Debian/Pi OS build only.
SYSTEM_CHROMIUM_PATH = "/usr/bin/chromium"

# The kiosk posts rendered label PNGs here; the scanner client spools them to CUPS itself
# (see _print_labels) so Chromium's print preview is never invoked for labels. --kiosk-printing
# (_build_browser_args) is unrelated to this path now — it only guards a stray window.print()
# from ever showing a dialog if something outside this route ever calls it.
KIOSK_PRINT_PATH = "/api/v1/scanner/kiosk/print"
# Per-machine hardware settings for the kiosk page (QR input, camera choice). Answered locally
# like the print path — never forwarded to the server and never given the device credential.
KIOSK_HARDWARE_PATH = "/api/v1/scanner/kiosk/hardware"
# Face check (see app/face): the page sends camera frames here and gets only a verdict or a hint
# back. Answered locally - the server never sees a frame or an embedding. The one image that leaves
# is the chip photo of a check-in whose face matched: handed to the page once with the verdict, so
# /check-in can keep it as the person's photo when they have none.
KIOSK_FACE_PATH_PREFIX = "/api/v1/scanner/kiosk/face/"
# Why the page gave up on the camera, the person skipped or staff bypassed it with the device PIN;
# the only words `face/cancel` will log.
KIOSK_FACE_END_REASONS = frozenset(
    {
        "camera_denied",
        "camera_not_found",
        "camera_failed",
        "scanner_unreachable",
        "user_skipped",
        "staff_bypass",
    }
)
KIOSK_FACE_ACTIONS = ("start", "frame", "verify", "cancel")
KIOSK_FACE_PATHS = frozenset(f"{KIOSK_FACE_PATH_PREFIX}{action}" for action in KIOSK_FACE_ACTIONS)
KIOSK_FACE_MAX_BODY_BYTES = 6 * 1024 * 1024
DEFAULT_FACE_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
KIOSK_PRINT_MAX_LABELS = 20
KIOSK_PRINT_MAX_PNG_BYTES = 256 * 1024
KIOSK_PRINT_TIMEOUT_SEC = 20.0
# The frontend's fetch to KIOSK_PRINT_PATH (kiosk-print.api.ts) times out at 30s; with up to
# KIOSK_PRINT_MAX_LABELS labels at KIOSK_PRINT_TIMEOUT_SEC each, a slow run could otherwise blow
# past that and the browser would show "failed" while labels keep printing, inviting a re-tap
# that duplicates labels. Stop starting new labels once this overall budget is spent instead, and
# report what printed so far so the UI can show a clear partial result.
KIOSK_PRINT_OVERALL_DEADLINE_SEC = 25.0
# Labels are rendered at the printer's 203 dpi, so 1 image px = 1 printer dot.
KIOSK_PRINT_PPI = 203
# Pause between ESC/POS labels of one print: the device write returns once the printer has the
# bytes, not once it has printed and cut, and kiosk3 drops a cut when the next label arrives
# mid-cut (two people came out as one strip). 2 s keeps ~10 labels inside the overall deadline.
ESCPOS_LABEL_PAUSE_SEC = 2.0
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# Kernel usblp exposes printers as /dev/usb/lpN; sysfs lists them with their USB ids.
USBMISC_SYSFS = Path("/sys/class/usbmisc")
USB_DEV_DIR = Path("/dev/usb")
# Paths this client answers itself; a request that is not a same-origin POST gets a local 404
# so it never reaches the server (and its access log).
LOCAL_ONLY_PATHS = frozenset({KIOSK_PRINT_PATH, KIOSK_HARDWARE_PATH}) | KIOSK_FACE_PATHS


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
        # Unset follows the mode (kiosk: on, debug window: off); an explicit value wins in both modes.
        raw_silent_print = str(config.get("KIOSK_SILENT_PRINT") or "").strip().lower()
        self.silent_print = (
            raw_silent_print in ("true", "1", "yes") if raw_silent_print else not self.is_debug
        )
        # Labels always go straight to this CUPS queue via `lp` (no browser print dialog in any mode).
        self.printer_name = str(config.get("PRINTER_NAME") or "").strip() or "tent_xprinter"
        # `cups` (default, Raspberry Pi + XP-365B) spools through lp; `escpos` writes the raster
        # straight to the printer's usblp device. Values are validated in app.config.
        self.printer_backend = str(config.get("PRINTER_BACKEND") or "cups").strip().lower()
        self.printer_usb_id = str(config.get("PRINTER_USB_ID") or "").strip().lower()
        self.printer_device = str(config.get("PRINTER_DEVICE") or "").strip()
        self.printer_width_dots = int(
            config.get("PRINTER_WIDTH_DOTS") or DEFAULT_PRINTER_WIDTH_DOTS
        )
        self._escpos_lock = asyncio.Lock()
        # When the last ESC/POS label went out: a large household prints in several requests, and
        # the first label of the next one must not land while the previous label is still cutting.
        self._escpos_last_label_at: Optional[float] = None
        # `off` hides the QR method on the kiosk home screen and closes /kiosk/qr on this machine.
        self.qr_check_in = str(config.get("KIOSK_QR_CHECK_IN") or "on").strip().lower() != "off"
        # How /kiosk/qr reads QR codes: camera, a USB keyboard-wedge reader, or both.
        self.qr_input = str(config.get("KIOSK_QR_INPUT") or "camera").strip().lower()
        self.camera_label = str(config.get("KIOSK_CAMERA_LABEL") or "").strip()
        self.qr_reader_max_gap_ms = int(
            config.get("KIOSK_QR_READER_MAX_GAP_MS") or DEFAULT_QR_READER_GAP_MS
        )
        # `pcsc` (default) reads through pcscd; `rfpro` talks to the HID module on kiosk3.
        self.card_reader = str(config.get("CARD_READER") or "pcsc").strip().lower()
        self.card_reader_usb_id = str(config.get("CARD_READER_USB_ID") or "").strip() or DEFAULT_CARD_READER_USB_ID
        # Face check: off (default - nothing changes) or on.
        self.face_mode = str(config.get("KIOSK_FACE_CHECK") or "off").strip().lower()
        raw_flows = str(config.get("KIOSK_FACE_CHECK_FLOWS") or "").replace(" ", "")
        self.face_flows = tuple(
            flow for flow in (raw_flows.split(",") if raw_flows else FACE_CHECK_FLOWS) if flow in FACE_CHECK_FLOWS
        )
        self.face_service = None
        if self.face_mode != "off":
            # Imported only now: a kiosk with the face check off needs no OpenCV installed.
            from app.face.profiles import get_profile
            from app.face.service import FaceService

            self.face_service = FaceService(
                Path(str(config.get("KIOSK_FACE_MODELS_DIR") or "").strip() or DEFAULT_FACE_MODELS_DIR),
                get_profile(str(config.get("KIOSK_FACE_THRESHOLD_PROFILE") or "").strip()),
            )
            if self.face_mode == "on":
                logger.warning(
                    "KIOSK_FACE_CHECK=on: the face thresholds are not calibrated on real chip photos yet; "
                    "keep KIOSK_FACE_CHECK=off on a kiosk in service until the Phase 0 checks on it are done"
                )
        # The reader is one device: the card polling and a face-check photo read must take turns.
        self._reader_lock = asyncio.Lock()
        self.poll_interval = float(config.get("POLL_INTERVAL", "0.5"))
        self.min_reading_display = 0.6
        self.client_nav_timeout_ms = 5000
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
        self.register_card_path = "/kiosk/register/card"
        self.register_path_prefix = "/kiosk/register/"
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

    def _create_reader(self):
        if self.card_reader == "rfpro":
            return RfproThaiCardReader(self.card_reader_usb_id)
        return ThaiSmartCardReader()

    async def _drop_reader(self) -> None:
        """Forget a reader whose hardware vanished so init_reader() waits for it again."""
        reader, self.reader = self.reader, None  # nothing new picks it up from here on
        close = getattr(reader, "close", None)
        if not callable(close):
            return
        async with self._reader_lock:
            try:
                await asyncio.to_thread(close)
            except Exception as error:
                logger.warning("Closing the lost card reader failed: %s", type(error).__name__)

    async def init_reader(self) -> bool:
        """Attempt to initialize the Smart Card Reader driver"""
        while self.running:
            try:
                if self.card_reader == "rfpro":
                    # Opening the HID node can block up to a command timeout: keep it off the loop.
                    self.reader = await asyncio.to_thread(self._create_reader)
                else:
                    self.reader = self._create_reader()
                logger.info("Smart Card Reader ready.")
                return True
            except Exception as e:
                # rfpro errors name the missing permission/device; pyscard's never carry card data.
                hint = f": {e}" if self.card_reader == "rfpro" and str(e) else ""
                logger.warning(f"Waiting for Smart Card Reader hardware ({self.card_reader}){hint}")
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
            "/api/v1/scanner/kiosk/config",
            "/api/v1/scanner/kiosk/register",
            "/api/v1/scanner/kiosk/staff-pin/verify",
            "/api/v1/scanner/kiosk/thaid/session",
            "/api/v1/scanner/kiosk/thaid/session/status",
            "/api/v1/scanner/kiosk/thaid/session/cancel",
        }

        headers = dict(request.headers)
        headers.pop("x-device-id", None)
        headers.pop("x-device-secret", None)
        same_origin_post = (
            request.method == "POST"
            and request_origin == configured_origin
            and request_url.scheme == configured_url.scheme
            and request_url.netloc == configured_url.netloc
        )
        if same_origin_post and request_url.path == KIOSK_PRINT_PATH:
            await self._fulfill_print(route)
            return
        if same_origin_post and request_url.path == KIOSK_HARDWARE_PATH:
            await self._fulfill_hardware(route)
            return
        if same_origin_post and request_url.path in KIOSK_FACE_PATHS:
            await self._fulfill_face(route, request_url.path.removeprefix(KIOSK_FACE_PATH_PREFIX))
            return
        if request_url.path in LOCAL_ONLY_PATHS:
            await route.fulfill(
                status=404,
                content_type="application/json",
                headers={"cache-control": "no-store"},
                body=json.dumps({"error": {"code": "NOT_FOUND"}}),
            )
            return
        if not same_origin_post or request_url.path not in allowed_paths:
            await route.continue_(headers=headers)
            return

        headers["x-device-id"] = self.device_id
        headers["x-device-secret"] = self.device_secret
        await route.continue_(headers=headers)

    async def _fulfill_hardware(self, route) -> None:
        """Tell the kiosk page how this machine reads QR codes. No credentials in the body."""
        await route.fulfill(
            status=200,
            content_type="application/json",
            headers={"cache-control": "no-store"},
            body=json.dumps(
                {
                    "qr_check_in": self.qr_check_in,
                    "qr_input": self.qr_input,
                    "camera_label": self.camera_label or None,
                    "reader_max_gap_ms": self.qr_reader_max_gap_ms,
                    "face_check": {
                        "mode": self.face_mode if self.face_service else "off",
                        "flows": list(self.face_flows) if self.face_service else [],
                    },
                }
            ),
        )

    async def _grant_camera_permission(self, context) -> None:
        """Let the kiosk page open the camera without a permission prompt. The face check and the
        camera QR scan both open the camera; in --kiosk mode nobody can answer a prompt, and the
        browser profile is in /tmp, so an earlier "allow" would not survive a reboot. A reader-only
        kiosk (or one with QR check-in off) with the face check off never asks for the camera, so
        it is not given one."""
        qr_uses_camera = self.qr_check_in and self.qr_input in ("camera", "both")
        if self.face_service is None and not qr_uses_camera:
            return
        parts = urllib.parse.urlsplit(self.tent_base_url)
        try:
            await context.grant_permissions(["camera"], origin=f"{parts.scheme}://{parts.netloc}")
        except Exception as error:
            logger.warning(
                "Could not grant the camera permission; the face check may wait for a prompt (%s: %s)",
                type(error).__name__,
                error,
            )

    async def _read_chip_photo(self) -> Optional[bytes]:
        """Read the chip photo from the inserted card for a check-in face check."""
        reader = self.reader
        if reader is None:
            return None
        async with self._reader_lock:
            if self.reader is not reader:
                return None  # the reader was dropped (unplugged) while this read waited its turn
            return await asyncio.to_thread(reader.read_photo)

    async def _fulfill_face(self, route, action: str) -> None:
        """Answer a face-check request locally. Bodies and errors carry no image, ID or score."""
        status, body = await self._face_request(action, route.request.post_data_buffer)
        await route.fulfill(
            status=status,
            content_type="application/json",
            headers={"cache-control": "no-store"},
            body=json.dumps(body),
        )

    async def _face_request(self, action: str, raw: Optional[bytes]) -> tuple[int, Dict[str, Any]]:
        from app.face.service import FaceInputError, FaceStateError

        def failure(status: int, code: str, message: str) -> tuple[int, Dict[str, Any]]:
            return status, {"error": {"code": code, "message": message}}

        service = self.face_service
        if service is None:
            return failure(404, "FACE_CHECK_DISABLED", "เครื่องนี้ไม่ได้เปิดการตรวจใบหน้า")
        raw = raw or b""
        if len(raw) > KIOSK_FACE_MAX_BODY_BYTES:
            return failure(413, "INVALID_FACE_INPUT", "ข้อมูลภาพใหญ่เกินไป")

        try:
            if action == "start":
                payload = self._json_object(raw)
                citizen_id = str(payload.get("citizen_id") or "")
                flow = payload.get("flow")
                if not re.fullmatch(r"\d{13}", citizen_id) or flow not in self.face_flows:
                    raise FaceInputError("invalid start request")
                read_photo = self._read_chip_photo if flow == "check_in" else None
                return 200, await service.start(citizen_id, flow, read_photo)
            if action == "frame":
                return 200, await service.frame(raw)
            if action == "verify":
                frames = self._decode_frames(self._json_object(raw).get("frames"))
                return 200, await service.verify(frames)
            service.cancel()
            self._log_face_end_reason(raw)
            return 200, {"ok": True}
        except FaceInputError:
            return failure(400, "INVALID_FACE_INPUT", "ข้อมูลสำหรับตรวจใบหน้าไม่ถูกต้อง")
        except FaceStateError:
            return failure(409, "FACE_CHECK_NOT_STARTED", "การตรวจใบหน้าไม่ได้เริ่มหรือหมดเวลาแล้ว")
        except FileNotFoundError as error:
            logger.error("Face check models are missing: %s", error)
            return failure(503, "FACE_MODELS_MISSING", "ยังไม่ได้ติดตั้งโมเดลตรวจใบหน้า")
        except Exception as error:
            logger.error("Face check %s failed: %s", action, self._describe_failure(error))
            return failure(500, "FACE_CHECK_FAILED", "ตรวจใบหน้าไม่สำเร็จ")

    @staticmethod
    def _log_face_end_reason(raw: bytes) -> None:
        """The page may say why it ended the face check early, so a pilot can tell a denied camera
        from a missing one. Only a fixed set of words is logged; any other body is ignored."""
        try:
            payload = json.loads(raw or b"")
        except (ValueError, UnicodeDecodeError):
            return
        reason = payload.get("reason") if isinstance(payload, dict) else None
        if isinstance(reason, str) and reason in KIOSK_FACE_END_REASONS:
            logger.info("Face check ended early: reason=%s", reason)

    @staticmethod
    def _json_object(raw: bytes) -> Dict[str, Any]:
        from app.face.service import FaceInputError

        try:
            payload = json.loads(raw or b"")
        except (ValueError, UnicodeDecodeError):
            raise FaceInputError("not JSON") from None
        if not isinstance(payload, dict):
            raise FaceInputError("not an object")
        return payload

    @staticmethod
    def _decode_frames(encoded: Any) -> list[bytes]:
        from app.face.service import FaceInputError, MAX_FRAMES

        if not isinstance(encoded, list) or not 1 <= len(encoded) <= MAX_FRAMES:
            raise FaceInputError("frames")
        frames = []
        for item in encoded:
            if not isinstance(item, str):
                raise FaceInputError("frame")
            try:
                frames.append(base64.b64decode(item, validate=True))
            except (binascii.Error, ValueError):
                raise FaceInputError("frame") from None
        return frames

    async def _fulfill_print(self, route) -> None:
        """Answer the kiosk print request locally; the server never sees label images."""
        status, body = await self._print_labels(route.request.post_data_buffer)
        await route.fulfill(
            status=status,
            content_type="application/json",
            headers={"cache-control": "no-store"},
            body=json.dumps(body),
        )

    @staticmethod
    def _decode_labels(raw: Optional[bytes]) -> Optional[list]:
        try:
            payload = json.loads(raw or b"")
        except (ValueError, UnicodeDecodeError):
            return None
        labels = payload.get("labels") if isinstance(payload, dict) else None
        if not isinstance(labels, list) or not 1 <= len(labels) <= KIOSK_PRINT_MAX_LABELS:
            return None
        images = []
        for label in labels:
            if not isinstance(label, str) or len(label) > KIOSK_PRINT_MAX_PNG_BYTES * 2:
                return None
            try:
                image = base64.b64decode(label, validate=True)
            except (binascii.Error, ValueError):
                return None
            if len(image) > KIOSK_PRINT_MAX_PNG_BYTES or not image.startswith(PNG_SIGNATURE):
                return None
            images.append(image)
        return images

    @property
    def _print_target(self) -> str:
        """Log-safe name of where labels go (never label content)."""
        if self.printer_backend == "escpos":
            return f"escpos:{self.printer_device or self.printer_usb_id}"
        return f"queue {self.printer_name}"

    async def _print_labels(self, raw: Optional[bytes]) -> tuple[int, Dict[str, Any]]:
        images = self._decode_labels(raw)
        if images is None:
            return 400, {"error": {"code": "INVALID_LABELS", "message": "ข้อมูล label ไม่ถูกต้อง"}}

        deadline = time.monotonic() + KIOSK_PRINT_OVERALL_DEADLINE_SEC
        printed = 0
        for index, image in enumerate(images):
            if self.printer_backend == "escpos":
                # Let the previous label finish printing and cutting first, also when it was the last
                # label of the previous request.
                if index:
                    await asyncio.sleep(ESCPOS_LABEL_PAUSE_SEC)
                elif self._escpos_last_label_at is not None:
                    wait = ESCPOS_LABEL_PAUSE_SEC - (time.monotonic() - self._escpos_last_label_at)
                    if wait > 0:
                        await asyncio.sleep(wait)
            if time.monotonic() >= deadline:
                logger.error(
                    f"Label print deadline exceeded on {self._print_target} ({printed}/{len(images)} sent)"
                )
                return 502, {
                    "printed": printed,
                    "error": {
                        "code": "PRINT_TIMEOUT",
                        "message": "พิมพ์ label ช้ากว่ากำหนด กรุณาลองอีกครั้ง",
                    },
                }
            if not await self._spool_label(image, first=index == 0):
                logger.error(f"Label print failed on {self._print_target} ({printed}/{len(images)} sent)")
                return 502, {
                    "printed": printed,
                    "error": {
                        "code": "PRINT_FAILED",
                        "message": "ส่งงานพิมพ์ไม่สำเร็จ กรุณาตรวจเครื่องพิมพ์หรือติดต่อเจ้าหน้าที่",
                    },
                }
            printed += 1
            if self.printer_backend == "escpos":
                self._escpos_last_label_at = time.monotonic()
        return 200, {"printed": printed}

    async def _spool_label(self, image: bytes, first: bool = True) -> bool:
        if self.printer_backend == "escpos":
            return await self._write_escpos(image, init=first)
        # stdin keeps the label (evacuee name) off disk; the job title carries no personal data.
        try:
            process = await asyncio.create_subprocess_exec(
                "lp",
                "-d", self.printer_name,
                "-t", "tent-kiosk-label",
                "-o", f"ppi={KIOSK_PRINT_PPI}",
                "-",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except OSError:
            return False
        try:
            await asyncio.wait_for(process.communicate(image), timeout=KIOSK_PRINT_TIMEOUT_SEC)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            return False
        return process.returncode == 0

    def _find_printer_device(self) -> Path | None:
        """Resolve the printer's device node. Looked up per label: replugging changes lpN."""
        if self.printer_device:
            return Path(self.printer_device)
        wanted = self.printer_usb_id
        if not wanted:
            return None
        try:
            entries = sorted(USBMISC_SYSFS.glob("lp*"))
        except OSError:
            return None
        for entry in entries:
            usb_device = Path(os.path.realpath(entry / "device")).parent
            try:
                vendor = (usb_device / "idVendor").read_text().strip().lower()
                product = (usb_device / "idProduct").read_text().strip().lower()
            except OSError:
                continue
            if f"{vendor}:{product}" == wanted:
                return USB_DEV_DIR / entry.name
        return None

    def _send_escpos(self, image: bytes, timeout: float, init: bool = True) -> bool:
        """Blocking: convert, locate and write one label. Runs in a worker thread."""
        try:
            # Imported here so CUPS-only machines never load Pillow just to start the kiosk.
            from app.escpos import CUT_SELF_FEED_MM, LABEL_LENGTH_MM, label_to_escpos

            data = label_to_escpos(
                image,
                self.printer_width_dots,
                label_length_mm=LABEL_LENGTH_MM,
                init=init,
                self_feed_mm=CUT_SELF_FEED_MM,
            )
        except Exception:  # noqa: BLE001 - Pillow raises DecompressionBombError and others outside ValueError
            logger.error("Label image could not be converted for the ESC/POS printer")
            return False
        device = self._find_printer_device()
        if device is None:
            logger.error(f"ESC/POS printer {self.printer_usb_id or '(no id)'} not found; is it on and plugged in?")
            return False
        deadline = time.monotonic() + timeout
        try:
            # Non-blocking + select keeps this thread bounded by `deadline` even if the
            # printer stalls, so a timed-out job cannot linger and interleave with the next.
            fd = os.open(device, os.O_WRONLY | os.O_NONBLOCK)
        except PermissionError:
            logger.error(
                f"No permission to open {device}: add the kiosk user to group lp "
                "(sudo usermod -aG lp <user>), then log in again"
            )
            return False
        except OSError as error:
            logger.error(f"Cannot open ESC/POS printer {device}: {error.strerror or 'error'}")
            return False
        try:
            view = memoryview(data)
            while view:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    logger.error(f"ESC/POS write to {device} timed out")
                    return False
                _, writable, _ = select.select([], [fd], [], remaining)
                if not writable:
                    continue
                try:
                    view = view[os.write(fd, view) :]
                except BlockingIOError:
                    continue
            # usblp accepts a non-blocking write as soon as the URB is queued, and close() unlinks
            # any URB still in flight: the label's tail (with GS V B 0) is dropped, the printer is
            # left waiting mid-raster and the next job prints as garbage. usblp only reports
            # POLLOUT once the last write URB has completed, so wait for that before closing.
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([], [fd], [], remaining)[1]:
                logger.error(f"ESC/POS write to {device} did not finish before the timeout")
                return False
            return True
        except OSError as error:
            logger.error(f"ESC/POS write to {device} failed: {error.strerror or 'error'}")
            return False
        finally:
            os.close(fd)

    async def _write_escpos(self, image: bytes, init: bool = True) -> bool:
        async with self._escpos_lock:
            try:
                return await asyncio.wait_for(
                    asyncio.to_thread(self._send_escpos, image, KIOSK_PRINT_TIMEOUT_SEC, init),
                    timeout=KIOSK_PRINT_TIMEOUT_SEC + 1.0,
                )
            except TimeoutError:
                logger.error("ESC/POS print timed out")
                return False
            except Exception:  # noqa: BLE001
                # The route must always answer: an escaped exception leaves /print hanging.
                logger.error("ESC/POS print failed unexpectedly")
                return False

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

    @staticmethod
    def _describe_failure(error: BaseException) -> str:
        """Where and what failed, never the message: card reads handle personal data.

        Reader errors (RfproError) only ever carry command names and status codes, so their
        text is kept; for anything else only the type and the innermost code location are named.
        """
        text = type(error).__name__
        if isinstance(error, RfproError):
            text += f" ({error})"
        frames = traceback.extract_tb(error.__traceback__)
        if frames:
            last = frames[-1]
            text += f" at {os.path.basename(last.filename)}:{last.lineno} in {last.name}"
        return text

    async def _read_full_card_if_register_path(self) -> bool:
        """Read and hand off a full card only while the registration page is active."""
        if not self.page or self.page.is_closed() or not self.reader:
            return False
        if urllib.parse.urlsplit(self.page.url).path != self.register_card_path:
            return False

        stage = "handoff"
        try:
            # The page must be listening before the read starts so it can show the reading
            # state: a full read takes ~20-30s, and a card pulled out early loses the photo.
            await self.page.wait_for_selector(
                '[data-kiosk-register-ready="true"]', timeout=15000
            )
            await self.page.evaluate(
                "window.dispatchEvent(new CustomEvent('kiosk:smart-card-reading'))"
            )
            logger.info("Registration card page is ready; reading full smart-card data")
            stage = "read"
            started_at = time.monotonic()
            card = await asyncio.to_thread(self.reader.read_all_data)
            logger.info("Full smart-card read finished in %.1fs", time.monotonic() - started_at)
            if self.face_service and "walk_in" in self.face_flows:
                # Set the chip photo aside for the face check; it is used only if the person agrees.
                self.face_service.stash_photo(str(card.get("citizen_id") or ""), card.get("photo_base64"))
            stage = "handoff"
            await self.page.evaluate(
                "card => window.dispatchEvent(new CustomEvent('kiosk:smart-card-full-read', { detail: card }))",
                card,
            )
            logger.info("Full smart-card data sent to the kiosk registration flow")
            return True
        except ReaderLostError:
            raise  # the polling loop drops the reader and waits for the hardware
        except Exception as error:
            logger.error(
                "Full smart-card read or kiosk handoff failed at %s: %s",
                stage,
                self._describe_failure(error),
            )
            if self.page and not self.page.is_closed():
                try:
                    await self.page.evaluate(
                        "window.dispatchEvent(new CustomEvent('kiosk:smart-card-full-read-error'))"
                    )
                except Exception:
                    logger.warning("Could not notify the kiosk registration page about the card read error")
            return False

    async def _card_inserted(self) -> bool:
        """Poll the reader off the event loop: an HID reader can block for seconds."""
        reader = self.reader
        if not reader:
            return False
        async with self._reader_lock:
            return bool(await asyncio.to_thread(reader.is_card_inserted))

    async def _card_inserted_safely(self) -> bool:
        """Reader errors must not trap the kiosk on a result screen."""
        try:
            return await self._card_inserted()
        except ReaderLostError:
            logger.warning("Smart Card Reader disconnected; waiting for the hardware")
            await self._drop_reader()
            return False
        except Exception:
            logger.warning("Card reader poll failed while waiting for kiosk home")
            return False

    async def _wait_for_home_or_new_card(self) -> bool:
        """Wait for the result screen to close, or restart promptly for the next card."""
        full_read_attempted = False
        while (
            self.running
            and self.page
            and not self.page.is_closed()
            and urllib.parse.urlsplit(self.page.url).path != self.home_path
        ):
            if await self._card_inserted_safely():
                current_path = urllib.parse.urlsplit(self.page.url).path
                if current_path == self.register_card_path:
                    if not full_read_attempted:
                        full_read_attempted = True
                        await self._read_full_card_if_register_path()
                    await asyncio.sleep(0.5)
                    continue
                if current_path.startswith(self.register_path_prefix):
                    # Later walk-in steps (consent, done, ...) are not a card read screen — a
                    # card left in (or re-inserted into) the reader here must not restart the
                    # lookup flow out from under the person filling in consent.
                    await asyncio.sleep(0.5)
                    continue
                logger.info("New card inserted before returning home; restarting card flow")
                return True
            full_read_attempted = False
            await asyncio.sleep(0.5)
        return False

    async def _navigate(self, url: str) -> None:
        """Switch kiosk screens without a white flash.

        `page.goto` reloads the SPA (ssr=false) and paints a blank page until it re-boots.
        Clicking a same-origin anchor lets the SvelteKit router swap routes in place;
        a full load is only the fallback when the app is not on the kiosk origin yet.
        """
        if not self.page or self.page.is_closed():
            return

        target = urllib.parse.urlsplit(url)
        current = urllib.parse.urlsplit(self.page.url)
        if (current.scheme, current.netloc) == (target.scheme, target.netloc):
            try:
                await self.page.evaluate(
                    """href => {
                        const link = document.createElement('a');
                        link.href = href;
                        link.hidden = true;
                        document.body.appendChild(link);
                        link.click();
                        link.remove();
                    }""",
                    url,
                )
                await self.page.wait_for_url(
                    lambda current_url: urllib.parse.urlsplit(current_url).path == target.path,
                    wait_until="commit",
                    timeout=self.client_nav_timeout_ms,
                )
                return
            except Exception:
                logger.warning("Client-side kiosk navigation failed; falling back to full load")

        await self.page.goto(url)

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
                if not await self._card_inserted():
                    await asyncio.sleep(self.poll_interval)
                    continue

                if urllib.parse.urlsplit(self.page.url).path == self.register_card_path:
                    await self._read_full_card_if_register_path()
                    while self.running and self.reader and await self._card_inserted_safely():
                        await asyncio.sleep(self.poll_interval)
                    continue

                if self.face_service:
                    self.face_service.cancel()  # a new card is a new person
                logger.info("Card detected; reading citizen ID")
                await self._navigate(self.reading_url)
                try:
                    # Read off the event loop so Playwright stays responsive, and keep the
                    # reading loader up for a minimum time so fast reads don't flicker.
                    loop = asyncio.get_running_loop()
                    started_at = loop.time()
                    citizen_id = str(await asyncio.to_thread(self.reader.read_citizen_id)).strip()
                    if not re.fullmatch(r"\d{13}", citizen_id):
                        raise ValueError("Card did not provide a valid citizen ID")
                    remaining = self.min_reading_display - (loop.time() - started_at)
                    if remaining > 0:
                        await asyncio.sleep(remaining)

                    await self._navigate(self.remove_card_url)
                    await self.page.wait_for_selector(
                        '[data-kiosk-card-ready="true"]', timeout=15000
                    )
                    await self._dispatch_card_event("kiosk:smart-card-read", citizen_id)
                    logger.info("Smart-card identity sent to the shared kiosk lookup flow")
                except ReaderLostError:
                    raise
                except Exception:
                    logger.error("Smart-card read or kiosk handoff failed")
                    await self._navigate(
                        self._kiosk_url(
                            self.error_path,
                            {"error_msg": "อ่านข้อมูลบัตรไม่สำเร็จ กรุณาลองใหม่"},
                        )
                    )

                logger.info("Waiting for card removal")
                full_read_attempted = False
                while self.running and self.reader and await self._card_inserted():
                    if (
                        not full_read_attempted
                        and self.page
                        and urllib.parse.urlsplit(self.page.url).path == self.register_card_path
                    ):
                        full_read_attempted = True
                        await self._read_full_card_if_register_path()
                    await asyncio.sleep(self.poll_interval)

                if self.page.is_closed():
                    break
                if urllib.parse.urlsplit(self.page.url).path == self.remove_card_path:
                    await self._dispatch_card_event("kiosk:smart-card-removed")
                    logger.info("Card removed; waiting for staff to complete check-in")
                    await self._wait_for_home_or_new_card()
                elif urllib.parse.urlsplit(self.page.url).path != self.home_path:
                    await self._wait_for_home_or_new_card()
                else:
                    await self._navigate(self.home_url)
            except ReaderLostError:
                logger.warning("Smart Card Reader disconnected; waiting for the hardware")
                await self._drop_reader()
                if urllib.parse.urlsplit(self.page.url).path != self.home_path:
                    # Don't strand the person on a reading screen that can no longer finish.
                    await self._navigate(self.home_url)
                await asyncio.sleep(1.0)
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

        if self.silent_print:
            # Labels print via CUPS directly (_print_labels), not through Chromium — this only
            # suppresses the print-preview dialog if a page ever calls window.print() itself.
            base_args.append("--kiosk-printing")
            if self.executable_path != SYSTEM_CHROMIUM_PATH:
                logger.warning(
                    f"⚠️  Silent print is on but the browser is not {SYSTEM_CHROMIUM_PATH}; "
                    "managed print policies (no header/footer, no Save as PDF) may not apply"
                )

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
            await self._grant_camera_permission(context)
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
