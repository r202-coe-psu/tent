"""One inserted card -> window CustomEvents in the walk-in page (issue #1326 event contract)."""

import asyncio
import base64
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from app.scard import split_card_address  # reused from the kiosk, not copied

# Runs in the page. `dispatchEvent` returns false when a listener called preventDefault(),
# which is how the page acknowledges; so `!dispatchEvent(...)` is "acknowledged".
log = logging.getLogger(__name__)

DISPATCH_JS = """([name, detail]) => {
    const event = new CustomEvent(name, { detail, cancelable: true });
    return !window.dispatchEvent(event);
}"""


RETRY_INTERVAL_S = 0.5
ACK_TIMEOUT_S = 15.0
_DEFAULT_PORTS = {"http": 80, "https": 443}


def _now() -> datetime:
    return datetime.now().astimezone()


class CardSession:
    def __init__(
        self,
        shelter_url: str,
        walk_in_path: str = "/onsite/people/new",
        now: Callable[[], datetime] = _now,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ):
        self._shelter_url = shelter_url
        self._walk_in_path = walk_in_path
        self._now = now
        self._sleep = sleep
        self._monotonic = monotonic

    async def handle_card(self, reader: Any, page: Any) -> None:
        if not await self._dispatch(page, "scanner:card-reading", {}):
            return
        try:
            card = await asyncio.to_thread(self._read_card, reader)
        except Exception:
            await self._fail(page, "READ_FAILED")
            return
        if not await self._dispatch(page, "scanner:card-read", card):
            return
        try:
            photo = await asyncio.to_thread(reader.read_photo)
            photo_base64 = base64.b64encode(photo).decode("ascii")
        except Exception:
            await self._fail(page, "PHOTO_FAILED")
            return
        await self._dispatch(
            page,
            "scanner:card-photo",
            {
                "citizen_id": card["citizen_id"],
                "photo_base64": "data:image/jpeg;base64," + photo_base64,
            },
        )

    async def _fail(self, page: Any, code: str) -> None:
        log.warning("card error: %s", code)  # code only; never card contents
        await self._dispatch(page, "scanner:card-error", {"code": code})

    async def _dispatch(self, page: Any, name: str, detail: dict) -> bool:
        """True once the page acknowledged; False = dropped (wrong page or never acknowledged)."""
        deadline = self._monotonic() + ACK_TIMEOUT_S
        while True:
            if not await self._on_walk_in(page):
                log.warning("dropping %s: page is not the shelter walk-in page", name)
                return False
            try:
                if await page.evaluate(DISPATCH_JS, [name, detail]):
                    return True
            except Exception:
                pass  # navigation in progress: not acknowledged for this attempt
            await self._sleep(RETRY_INTERVAL_S)
            if self._monotonic() >= deadline:
                log.warning("dropping %s: not acknowledged within %ss", name, ACK_TIMEOUT_S)
                return False

    async def _on_walk_in(self, page: Any) -> bool:
        if not self._is_walk_in(page.url):
            await page.goto(self._walk_in_url())
        return self._is_walk_in(page.url)

    def _is_walk_in(self, url: str) -> bool:
        page_url = urlsplit(url)
        return self._origin(url) == self._origin(self._shelter_url) and (
            page_url.path == self._walk_in_path
        )

    @staticmethod
    def _origin(url: str) -> tuple[str, str | None, int | None]:
        parts = urlsplit(url)
        return parts.scheme, parts.hostname, parts.port or _DEFAULT_PORTS.get(parts.scheme)

    def _walk_in_url(self) -> str:
        shelter = urlsplit(self._shelter_url)
        return f"{shelter.scheme}://{shelter.netloc}{self._walk_in_path}"

    def _read_card(self, reader: Any) -> dict:
        """Text fields only, mirroring ThaiSmartCardReader.read_all_data() (inline there)."""
        if not reader.connect():
            raise RuntimeError("connect failed")
        citizen_id = reader.get_citizen_id()
        if not citizen_id:
            raise ValueError("no citizen id")
        name_parts = reader.get_thai_name_parts()
        dob = reader.get_date_of_birth()
        address = split_card_address(reader.get_address_parts())
        scanned_at = self._now()
        card = {
            "citizen_id": citizen_id,
            "first_name_th": name_parts[1].strip() if len(name_parts) > 1 else "",
            "last_name_th": name_parts[3].strip() if len(name_parts) > 3 else "",
            "gender": reader.get_gender(),
            "birth_date": dob,
            **{key: value or "" for key, value in address.items()},
            "scanned_at": scanned_at.isoformat(),
        }
        # Same rule as the kiosk: a usable DOB is >= 8 chars with a numeric BE year;
        # otherwise year/age are omitted (the page schema forbids null), not a failure.
        if len(dob) >= 8:
            try:
                birth_year_ce = int(dob[:4]) - 543
            except ValueError:
                pass
            else:
                card["birth_year_ce"] = birth_year_ce
                card["age"] = max(0, scanned_at.year - birth_year_ce)
        return card
