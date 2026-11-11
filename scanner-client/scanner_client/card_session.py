"""One inserted card -> window CustomEvents in the walk-in page (issue #1326 event contract)."""

import asyncio
import base64
from collections.abc import Callable
from datetime import datetime
from typing import Any

from app.scard import split_card_address  # reused from the kiosk, not copied

# Runs in the page. `dispatchEvent` returns false when a listener called preventDefault(),
# which is how the page acknowledges; so `!dispatchEvent(...)` is "acknowledged".
DISPATCH_JS = """([name, detail]) => {
    const event = new CustomEvent(name, { detail, cancelable: true });
    return !window.dispatchEvent(event);
}"""


def _now() -> datetime:
    return datetime.now().astimezone()


class CardSession:
    def __init__(self, now: Callable[[], datetime] = _now):
        self._now = now

    async def handle_card(self, reader: Any, page: Any) -> None:
        await self._dispatch(page, "scanner:card-reading", {})
        card = await asyncio.to_thread(self._read_card, reader)
        await self._dispatch(page, "scanner:card-read", card)
        photo = await asyncio.to_thread(reader.read_photo)
        await self._dispatch(
            page,
            "scanner:card-photo",
            {
                "citizen_id": card["citizen_id"],
                "photo_base64": "data:image/jpeg;base64," + base64.b64encode(photo).decode("ascii"),
            },
        )

    async def _dispatch(self, page: Any, name: str, detail: dict) -> bool:
        return await page.evaluate(DISPATCH_JS, [name, detail])

    def _read_card(self, reader: Any) -> dict:
        """Text fields only, mirroring ThaiSmartCardReader.read_all_data() (inline there)."""
        reader.connect()
        name_parts = reader.get_thai_name_parts()
        dob = reader.get_date_of_birth()
        birth_year_ce = int(dob[:4]) - 543
        address = split_card_address(reader.get_address_parts())
        scanned_at = self._now()
        return {
            "citizen_id": reader.get_citizen_id(),
            "first_name_th": name_parts[1].strip(),
            "last_name_th": name_parts[3].strip(),
            "gender": reader.get_gender(),
            "birth_date": dob,
            "birth_year_ce": birth_year_ce,
            "age": max(0, scanned_at.year - birth_year_ce),
            **{key: value or "" for key, value in address.items()},
            "scanned_at": scanned_at.isoformat(),
        }
