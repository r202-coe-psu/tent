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

log = logging.getLogger(__name__)

# Runs in the page. Refuses (= not acknowledged) unless the tab is still on the expected origin
# and path: closes the race between the Python-side url check and this call.
# `dispatchEvent` returns false when a listener called preventDefault(),
# which is how the page acknowledges; so `!dispatchEvent(...)` is "acknowledged".
DISPATCH_JS = """([name, detail, origin, path]) => {
    if (location.origin !== origin || location.pathname !== path) return false;
    const event = new CustomEvent(name, { detail, cancelable: true });
    return !window.dispatchEvent(event);
}"""


# Runs in the page. Navigates through the SvelteKit router (it intercepts same-origin <a> clicks
# on the document) so the app swaps routes in place: page.goto() reloads the whole document and
# flashes a blank white screen while the SPA boots again.
NAVIGATE_JS = """(path) => {
    const link = document.createElement('a');
    link.href = path;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
}"""

RETRY_INTERVAL_S = 0.5
# In-app navigation that has not reached the walk-in page by then (staff kept unsaved work when
# the page asked, a router that ignored the click) drops the card; staff insert it again.
IN_APP_NAVIGATION_TIMEOUT_S = 3.0
ACK_TIMEOUT_S = 15.0
_DEFAULT_PORTS = {"http": 80, "https": 443}
# Where the app parks a signed-out staff (frontend/src/lib/guards/auth.ts and the auth routes).
# A card inserted there is ignored: the walk-in page would only bounce back to sign-in.
SIGNED_OUT_PATHS = frozenset(
    {"/login", "/admin-login", "/forgot-password", "/mfa-challenge", "/force-setup", "/consent"}
)


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
        self._may_navigate = True

    async def handle_card(self, reader: Any, page: Any) -> None:
        # One navigation per card: when an auth guard sends the tab back to sign-in, the card is
        # dropped instead of bouncing between sign-in and walk-in until the ack timeout.
        self._may_navigate = True
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
                if await page.evaluate(DISPATCH_JS, [name, detail, *self._expected()]):
                    return True
            except Exception:
                pass  # navigation in progress: not acknowledged for this attempt
            await self._sleep(RETRY_INTERVAL_S)
            if self._monotonic() >= deadline:
                log.warning("dropping %s: not acknowledged within %ss", name, ACK_TIMEOUT_S)
                return False

    async def _on_walk_in(self, page: Any) -> bool:
        if self._is_walk_in(page.url):
            return True
        if not self._may_navigate:
            return False
        self._may_navigate = False
        if self._origin(page.url) != self._origin(self._shelter_url):
            # startup (blank tab, URL prompt) or another site: the tab is left alone
            log.info("card ignored: the tab is not on the shelter site")
            return False
        if self._is_signed_out(page.url):
            log.info("card ignored: staff is not signed in")
            return False
        await self._navigate_in_app(page)
        if not self._is_walk_in(page.url):
            # e.g. staff kept unsaved work when the page asked: never reload past their answer
            log.warning("card dropped: the tab did not move to the walk-in page")
            return False
        return True

    async def _navigate_in_app(self, page: Any) -> None:
        try:
            await page.evaluate(NAVIGATE_JS, self._walk_in_path)
            await page.wait_for_url(
                self._is_walk_in,
                wait_until="commit",
                timeout=IN_APP_NAVIGATION_TIMEOUT_S * 1000,
            )
        except Exception as exc:  # not there yet: _on_walk_in drops the card
            log.info("in-app navigation to walk-in did not finish: %s", type(exc).__name__)

    def _is_signed_out(self, url: str) -> bool:
        return (
            self._origin(url) == self._origin(self._shelter_url)
            and urlsplit(url).path.rstrip("/") in SIGNED_OUT_PATHS
        )

    def _is_walk_in(self, url: str) -> bool:
        page_url = urlsplit(url)
        return self._origin(url) == self._origin(self._shelter_url) and (
            page_url.path == self._walk_in_path
        )

    @staticmethod
    def _origin(url: str) -> tuple[str, str | None, int | None]:
        parts = urlsplit(url)
        return parts.scheme, parts.hostname, parts.port or _DEFAULT_PORTS.get(parts.scheme)

    def _expected(self) -> tuple[str, str]:
        shelter = urlsplit(self._shelter_url)
        return f"{shelter.scheme}://{shelter.netloc}", self._walk_in_path

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
