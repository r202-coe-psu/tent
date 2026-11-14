"""Print the page's labels on this PC's USB label printer (issue #1326).

The page posts rendered label PNGs to PRINT_PATH (`{"labels": [base64 PNG, ...]}`) and asks
PRINTER_PATH whether this PC has the printer (frontend scanner-client-print.api.ts). The scanner
client answers both itself through Playwright routing: they never reach the server, and a label
(it carries the evacuee's name) is never written to disk or logged.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol
from urllib.parse import urlsplit

PRINT_PATH = "/api/v1/scanner-client/print"
PRINTER_PATH = "/api/v1/scanner-client/printer"
LOCAL_PATHS = frozenset({PRINT_PATH, PRINTER_PATH})

# The page sends at most 8 labels per request and gives up on a request after 30 s
# (scanner-client-print.api.ts), so stop starting labels after 25 s and say how many printed.
MAX_LABELS = 20
MAX_PNG_BYTES = 256 * 1024
LABEL_TIMEOUT_SEC = 20.0
OVERALL_DEADLINE_SEC = 25.0
# Past a label's timeout, stop waiting for it: a stuck spooler call cannot be interrupted.
HANG_GRACE_SEC = 2.0
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

log = logging.getLogger(__name__)


class LabelPrinter(Protocol):
    name: str

    def is_installed(self) -> bool: ...

    def print_png(self, png: bytes, timeout: float) -> bool: ...


def decode_labels(raw: bytes | None) -> list[bytes] | None:
    """The PNGs of a `{"labels": [base64 PNG, ...]}` body; None unless it holds 1-20 small PNGs."""
    try:
        payload = json.loads(raw or b"")
    except (ValueError, UnicodeDecodeError):
        return None
    labels = payload.get("labels") if isinstance(payload, dict) else None
    if not isinstance(labels, list) or not 1 <= len(labels) <= MAX_LABELS:
        return None
    images = []
    for label in labels:
        if not isinstance(label, str) or len(label) > MAX_PNG_BYTES * 2:
            return None
        try:
            image = base64.b64decode(label, validate=True)
        except (binascii.Error, ValueError):
            return None
        if len(image) > MAX_PNG_BYTES or not image.startswith(PNG_SIGNATURE):
            return None
        images.append(image)
    return images


def _error(code: str, message: str, printed: int | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if printed is not None:
        body["printed"] = printed
    return body


class LocalPrintRoutes:
    """Answers PRINT_PATH and PRINTER_PATH for same-origin POSTs from the shelter page; any other
    request to them gets a local 404 so it never reaches a server."""

    def __init__(
        self,
        shelter_origin: str,
        printer: LabelPrinter,
        *,
        run: Callable[..., Awaitable[Any]] = asyncio.to_thread,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._origin = shelter_origin
        self._printer = printer
        self._run = run  # printing blocks (spooler, lp): keep it off the event loop
        self._clock = clock

    async def handle(self, route: Any) -> None:
        request = route.request
        url = urlsplit(request.url)
        same_origin_post = (
            request.method == "POST"
            and request.headers.get("origin") == self._origin
            and f"{url.scheme}://{url.netloc}" == self._origin
        )
        if not same_origin_post or url.path not in LOCAL_PATHS:
            await self._reply(route, 404, {"error": {"code": "NOT_FOUND"}})
        elif url.path == PRINTER_PATH:
            available = await self._run(self._printer.is_installed)
            await self._reply(route, 200, {"available": available, "name": self._printer.name})
        else:
            status, body = await self._print(request.post_data_buffer)
            await self._reply(route, status, body)

    async def _print(self, raw: bytes | None) -> tuple[int, dict[str, Any]]:
        images = decode_labels(raw)
        if images is None:
            return 400, _error("INVALID_LABELS", "ข้อมูล label ไม่ถูกต้อง")
        if not await self._run(self._printer.is_installed):
            log.error("label printer %s is not installed", self._printer.name)
            return 503, _error(
                "PRINTER_NOT_FOUND",
                f"ไม่พบเครื่องพิมพ์ {self._printer.name} ในเครื่องนี้",
                printed=0,
            )
        deadline = self._clock() + OVERALL_DEADLINE_SEC
        printed = 0
        for image in images:
            left = deadline - self._clock()
            if left <= 0:
                log.error("label print deadline passed (%d/%d sent)", printed, len(images))
                return 502, _error(
                    "PRINT_TIMEOUT", "พิมพ์ label ช้ากว่ากำหนด กรุณาลองอีกครั้ง", printed=printed
                )
            timeout = min(LABEL_TIMEOUT_SEC, left)
            try:
                sent = await asyncio.wait_for(
                    self._run(self._printer.print_png, image, timeout), timeout + HANG_GRACE_SEC
                )
            except TimeoutError:
                sent = False
            if not sent:
                log.error("label print failed (%d/%d sent)", printed, len(images))
                return 502, _error(
                    "PRINT_FAILED",
                    "ส่งงานพิมพ์ไม่สำเร็จ กรุณาตรวจเครื่องพิมพ์",
                    printed=printed,
                )
            printed += 1
        return 200, {"printed": printed}

    @staticmethod
    async def _reply(route: Any, status: int, body: dict[str, Any]) -> None:
        await route.fulfill(
            status=status,
            content_type="application/json",
            headers={"cache-control": "no-store"},
            body=json.dumps(body, ensure_ascii=False),
        )
