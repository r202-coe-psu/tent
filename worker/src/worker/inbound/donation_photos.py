"""Bind a public booking's donor photos to it (CR-175 donor photos FR-11a).

The BFF checked every photo when the donor booked, but the booking only names them; the
photo docs learn which booking holds them here, as ``image.donation_id``. That field is
what keeps a photo out of the orphan sweep (FR-16) and what refuses it to a second
booking (FR-10 ``PHOTO_ALREADY_USED``).

Every step reads the photo as it is now and writes only what is missing, so a run that
died half way, or a retry of a booking already bound, ends in the same state.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal

import httpx

from worker.couch.client import CouchClient
from worker.timeutil import iso_utc

logger = logging.getLogger(__name__)

#: FR-11a — read-modify-write attempts per photo before leaving it for the next poll.
BIND_ATTEMPTS = 3

#: Where one photo stands for one booking:
#: ``linked``  carries this booking's ``donation_id`` (now or from an earlier run);
#: ``foreign`` belongs to another booking, or is not a donation photo — never overwritten,
#:             and cut from this booking's ``photos``;
#: ``gone``    no such doc (swept by FR-16 before the booking reached CouchDB) — kept in
#:             ``photos`` so staff see "รูปไม่พร้อมใช้" (FR-13b);
#: ``pending`` could not be written this time (409 three times, or CouchDB failed).
PhotoLink = Literal["linked", "foreign", "gone", "pending"]


async def bind_photo(
    couch: CouchClient, database: str, photo_id: str, donation_id: str
) -> PhotoLink:
    verdict: PhotoLink = "gone"

    async def claim(photo: dict[str, Any]) -> dict[str, Any] | None:
        nonlocal verdict
        owner = photo.get("donation_id")
        if owner == donation_id:
            verdict = "linked"
            return None
        if owner or photo.get("purpose") != "donation":
            verdict = "foreign"
            return None
        verdict = "linked"
        now = iso_utc(datetime.now(UTC))
        return {**photo, "donation_id": donation_id, "updated_at": now}

    try:
        await couch.update_doc(database, photo_id, claim, attempts=BIND_ATTEMPTS)
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Could not bind photo %s to %s in %s (HTTP %s) — retrying next poll",
            photo_id,
            donation_id,
            database,
            exc.response.status_code,
        )
        return "pending"
    except Exception:
        logger.exception(
            "Could not bind photo %s to %s in %s — retrying next poll",
            photo_id,
            donation_id,
            database,
        )
        return "pending"
    return verdict


async def bind_photos(
    couch: CouchClient, database: str, donation_id: str, photo_ids: list[str]
) -> dict[str, PhotoLink]:
    return {
        photo_id: await bind_photo(couch, database, photo_id, donation_id)
        for photo_id in photo_ids
    }


def photos_to_keep(photo_ids: list[str], links: Mapping[str, PhotoLink]) -> list[str]:
    """``photos`` for the CouchDB booking: every id except one another booking holds."""
    return [photo_id for photo_id in photo_ids if links.get(photo_id) != "foreign"]


def photos_settled(links: Mapping[str, PhotoLink]) -> bool:
    """Nothing left to retry — ``DonationBuffer.photos_linked`` may become True."""
    return "pending" not in links.values()


async def drop_foreign_photos(
    couch: CouchClient,
    database: str,
    donation_id: str,
    links: Mapping[str, PhotoLink],
) -> bool:
    """Cut photos another booking holds from a booking already in CouchDB.

    Only the retry path needs this: the first write cuts them before the booking exists.
    Returns False when the booking could not be updated, so the retry comes round again.
    """
    foreign = {photo_id for photo_id, link in links.items() if link == "foreign"}
    if not foreign:
        return True

    async def cut(booking: dict[str, Any]) -> dict[str, Any] | None:
        photos = booking.get("photos") or []
        kept = [photo_id for photo_id in photos if photo_id not in foreign]
        if kept == photos:
            return None
        now = iso_utc(datetime.now(UTC))
        return {**booking, "photos": kept, "updated_at": now}

    try:
        await couch.update_doc(database, donation_id, cut)
    except Exception:
        logger.exception(
            "Could not cut photos %s from %s in %s",
            sorted(foreign),
            donation_id,
            database,
        )
        return False
    return True
