"""CR-175 donor photos FR-11a — inbound binds each photo to its booking, idempotently."""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from unittest.mock import MagicMock

import httpx
import pytest
from tent_model import DonationBuffer, DonorBuffer

from worker.couch.client import CouchClient
from worker.inbound.donations import (
    _persist_donation,
    _rebind_photos,
    run_inbound_once,
)

DB = "shelter_sh001"
DONATION = "donation:01K8D0NAT10N00000000000001"
OTHER = "donation:01K8D0NAT10N00000000000002"
P1 = "image:01K8PHXTX00000000000000001"
P2 = "image:01K8PHXTX00000000000000002"
P3 = "image:01K8PHXTX00000000000000003"


class FakeCouch:
    """One shelter DB in memory: GET/PUT with real `_rev` checks (409 on a stale one).

    ``conflicts[id] = n`` makes the next ``n`` PUTs of that doc lose to a concurrent
    writer; ``fail_puts`` lists docs whose PUT fails outright (CouchDB down mid-run).
    """

    def __init__(self, docs: list[dict]):
        self.docs = {d["_id"]: copy.deepcopy(d) for d in docs}
        self.revs = dict.fromkeys(self.docs, 1)
        self.conflicts: dict[str, int] = {}
        self.fail_puts: set[str] = set()
        self.puts: list[str] = []

    def client(self) -> CouchClient:
        settings = MagicMock(
            couch_base_url="http://couch:5984", couchdb_user="a", couchdb_password="b"
        )
        client = CouchClient(settings)
        client._client = httpx.AsyncClient(
            base_url="http://couch:5984", transport=httpx.MockTransport(self.handle)
        )
        return client

    def rev(self, doc_id: str) -> str:
        return f"{self.revs[doc_id]}-x"

    def handle(self, request: httpx.Request) -> httpx.Response:
        parts = request.url.path.strip("/").split("/", 1)
        if len(parts) == 1:
            return httpx.Response(200, json={"db_name": parts[0]})
        doc_id = parts[1]
        if doc_id == "_bulk_docs":
            return httpx.Response(201, json=[])
        if request.method == "GET":
            if doc_id not in self.docs:
                return httpx.Response(404, json={"error": "not_found"})
            return httpx.Response(
                200, json={**copy.deepcopy(self.docs[doc_id]), "_rev": self.rev(doc_id)}
            )
        if doc_id in self.fail_puts:
            return httpx.Response(500, json={"error": "unknown"})
        if self.conflicts.get(doc_id, 0) > 0:
            self.conflicts[doc_id] -= 1
            self.revs[doc_id] += 1  # someone else wrote it first
            return httpx.Response(409, json={"error": "conflict"})
        body = json.loads(request.content)
        if doc_id in self.docs and body.get("_rev") != self.rev(doc_id):
            return httpx.Response(409, json={"error": "conflict"})
        self.puts.append(doc_id)
        self.revs[doc_id] = self.revs.get(doc_id, 0) + 1
        self.docs[doc_id] = {k: v for k, v in body.items() if k != "_rev"}
        return httpx.Response(
            201, json={"ok": True, "id": doc_id, "rev": self.rev(doc_id)}
        )


def photo(photo_id: str, **over) -> dict:
    return {
        "_id": photo_id,
        "type": "image",
        "schema_v": 2,
        "shelter_code": "SH001",
        "purpose": "donation",
        "created_at": "2026-10-26T03:00:00.000Z",
        "updated_at": "2026-10-26T03:00:00.000Z",
        "_attachments": {"full": {"stub": True, "length": 10}},
        **over,
    }


async def buffer_row(photos: list[str], **over) -> DonationBuffer:
    """Insert the booking's buffer row — inbound re-reads and CASes it in Mongo."""
    fields = {
        "id": DONATION,
        "shelter_code": "SH001",
        "created_at": datetime(2026, 10, 26, 3, 0, tzinfo=UTC),
        "booking_ref": "DN-100001",
        "tracking_token": "TX-SH001-PHOTOS01",
        "tracking_token_hash": "hash",
        "donor": DonorBuffer(name="ผู้บริจาค", phone="0812345678"),
        "items_declared": [{"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน"}],
        "status": "pending_review",
        "photos": photos,
        "photos_linked": not photos,
        "synced_to_couch": False,
    }
    fields.update(over)
    return await DonationBuffer(**fields).insert()


async def stored() -> DonationBuffer:
    row = await DonationBuffer.get(DONATION)
    assert row is not None
    return row


async def persist(fake: FakeCouch, row: DonationBuffer) -> bool:
    return await _persist_donation(fake.client(), row)


def owner(fake: FakeCouch, photo_id: str) -> str | None:
    return fake.docs[photo_id].get("donation_id")


@pytest.mark.asyncio
async def test_binds_every_photo_and_copies_the_ids_onto_the_booking(db: None):
    fake = FakeCouch([photo(P1), photo(P2)])
    row = await buffer_row([P1, P2])

    assert await persist(fake, row) is True

    assert owner(fake, P1) == owner(fake, P2) == DONATION
    assert fake.docs[DONATION]["photos"] == [P1, P2]
    assert fake.docs[DONATION]["schema_v"] == 10
    # The attachments survive the rewrite: the stubs go back with the doc.
    assert fake.docs[P1]["_attachments"] == {"full": {"stub": True, "length": 10}}
    stored_row = await stored()
    assert (stored_row.synced_to_couch, stored_row.photos_linked) == (True, True)


@pytest.mark.asyncio
async def test_a_photo_another_booking_holds_is_left_alone_and_cut(db: None):
    fake = FakeCouch([photo(P1), photo(P2, donation_id=OTHER)])
    row = await buffer_row([P1, P2])

    assert await persist(fake, row) is True

    assert owner(fake, P2) == OTHER
    assert P2 not in fake.puts
    assert fake.docs[DONATION]["photos"] == [P1]
    assert (await stored()).photos_linked is True


@pytest.mark.asyncio
async def test_a_photo_that_is_not_a_donation_photo_is_never_claimed(db: None):
    fake = FakeCouch([photo(P1, purpose=None)])
    row = await buffer_row([P1])

    assert await persist(fake, row) is True

    assert owner(fake, P1) is None
    assert fake.docs[DONATION]["photos"] == []


@pytest.mark.asyncio
async def test_a_photo_already_swept_stays_on_the_booking_for_staff_to_see_missing(
    db: None,
):
    # FR-13b: staff get a "รูปไม่พร้อมใช้" tile rather than silently fewer photos.
    fake = FakeCouch([photo(P1)])
    row = await buffer_row([P1, P2])

    assert await persist(fake, row) is True

    assert fake.docs[DONATION]["photos"] == [P1, P2]
    assert (await stored()).photos_linked is True


@pytest.mark.asyncio
async def test_two_conflicts_are_retried_within_the_run(db: None):
    fake = FakeCouch([photo(P1)])
    fake.conflicts[P1] = 2
    row = await buffer_row([P1])

    assert await persist(fake, row) is True

    assert owner(fake, P1) == DONATION
    assert (await stored()).photos_linked is True


@pytest.mark.asyncio
async def test_a_reread_after_409_that_finds_another_booking_cuts_the_photo(db: None):
    fake = FakeCouch([photo(P1)])
    original = fake.handle

    def other_booking_wins(request: httpx.Request) -> httpx.Response:
        if (
            request.method == "PUT"
            and request.url.path.endswith(P1)
            and P1 not in fake.puts
        ):
            fake.docs[P1]["donation_id"] = OTHER
            fake.revs[P1] += 1
        return original(request)

    fake.handle = other_booking_wins  # type: ignore[method-assign]
    row = await buffer_row([P1])

    assert await persist(fake, row) is True

    assert owner(fake, P1) == OTHER
    assert fake.docs[DONATION]["photos"] == []
    assert (await stored()).photos_linked is True


@pytest.mark.asyncio
async def test_three_conflicts_write_the_booking_anyway_and_leave_the_photo_for_later(
    db: None,
):
    fake = FakeCouch([photo(P1), photo(P2)])
    fake.conflicts[P1] = 3
    row = await buffer_row([P1, P2])

    assert await persist(fake, row) is True

    assert owner(fake, P1) is None
    assert owner(fake, P2) == DONATION
    assert fake.docs[DONATION]["photos"] == [P1, P2]  # FR-11a: the id stays
    stored_row = await stored()
    assert (stored_row.synced_to_couch, stored_row.photos_linked) == (True, False)

    # Next poll: the retry binds it and settles the row.
    assert await _rebind_photos(fake.client(), row) is True
    assert owner(fake, P1) == DONATION
    assert (await stored()).photos_linked is True


@pytest.mark.asyncio
async def test_retry_cuts_a_photo_another_booking_took_meanwhile(db: None):
    fake = FakeCouch([photo(P1, donation_id=OTHER), photo(P2, donation_id=DONATION)])
    fake.docs[DONATION] = {"_id": DONATION, "type": "donation", "photos": [P1, P2]}
    fake.revs[DONATION] = 1
    row = await buffer_row([P1, P2], synced_to_couch=True, photos_linked=False)

    assert await _rebind_photos(fake.client(), row) is True

    assert fake.docs[DONATION]["photos"] == [P2]
    assert owner(fake, P1) == OTHER
    assert (await stored()).photos_linked is True


@pytest.mark.asyncio
async def test_retry_keeps_waiting_while_couchdb_refuses_the_write(db: None):
    fake = FakeCouch([photo(P1)])
    fake.fail_puts.add(P1)
    row = await buffer_row([P1], synced_to_couch=True, photos_linked=False)

    assert await _rebind_photos(fake.client(), row) is False
    assert (await stored()).photos_linked is False


@pytest.mark.asyncio
async def test_a_run_that_died_after_binding_converges_on_the_next_run(db: None):
    fake = FakeCouch([photo(P1), photo(P2)])
    fake.fail_puts.add(DONATION)
    row = await buffer_row([P1, P2])

    # The photos bind, then the booking write fails: the row stays unsynced.
    assert await persist(fake, row) is False
    assert owner(fake, P1) == owner(fake, P2) == DONATION
    assert (await stored()).synced_to_couch is False

    fake.fail_puts.clear()
    fake.puts.clear()
    assert await persist(fake, row) is True

    # Already bound to this booking: no photo is rewritten, and none is cut as foreign.
    assert fake.puts == [DONATION]
    assert fake.docs[DONATION]["photos"] == [P1, P2]
    stored_row = await stored()
    assert (stored_row.synced_to_couch, stored_row.photos_linked) == (True, True)


@pytest.mark.asyncio
async def test_rerunning_a_settled_booking_changes_nothing(db: None):
    fake = FakeCouch([photo(P1, donation_id=DONATION)])
    fake.docs[DONATION] = {"_id": DONATION, "type": "donation", "photos": [P1]}
    fake.revs[DONATION] = 1
    row = await buffer_row([P1], synced_to_couch=True, photos_linked=False)
    before = copy.deepcopy(fake.docs)

    for _ in range(3):
        assert await _rebind_photos(fake.client(), row) is True

    assert fake.docs == before
    assert fake.puts == []


# --- the poll picks up exactly the rows that still owe a binding (needs test Mongo) ---


async def _insert_buffer(
    doc_id: str, *, synced: bool, photos: list[str], photos_linked: bool
) -> None:
    n = doc_id[-1]
    await DonationBuffer(
        id=doc_id,
        shelter_code="SH001",
        donor=DonorBuffer(name="ผู้บริจาค", phone="0812345678"),
        items_declared=[{"free_text": "ผ้าห่ม", "qty": "2", "unit": "ผืน"}],
        booking_ref=f"DN-10000{n}",
        tracking_token=f"TX-{n}",
        tracking_token_hash=f"hash-{n}",
        status="pending_review",
        synced_to_couch=synced,
        photos=photos,
        photos_linked=photos_linked,
        created_at=datetime(2026, 10, 26, 3, 0, tzinfo=UTC),
    ).insert()


async def test_the_poll_retries_only_synced_rows_with_unbound_photos(db):
    retry_me = "donation:01K8D0NAT10N00000000000003"
    settled = "donation:01K8D0NAT10N00000000000004"
    await _insert_buffer(retry_me, synced=True, photos=[P1], photos_linked=False)
    await _insert_buffer(settled, synced=True, photos=[P2], photos_linked=True)
    fake = FakeCouch([photo(P1), photo(P2)])

    await run_inbound_once(fake.client())

    assert owner(fake, P1) == retry_me
    assert owner(fake, P2) is None  # settled rows are not touched again
    row = await DonationBuffer.get(retry_me)
    assert row is not None and row.photos_linked is True


async def test_a_row_written_before_photos_existed_is_not_retried(db):
    # Mongo rows from before CR-175 have neither field; the default reads as settled.
    legacy = "donation:01K8D0NAT10N00000000000005"
    await _insert_buffer(legacy, synced=True, photos=[], photos_linked=True)
    collection = DonationBuffer.get_pymongo_collection()
    await collection.update_one(
        {"_id": legacy}, {"$unset": {"photos": "", "photos_linked": ""}}
    )

    fake = FakeCouch([])
    await run_inbound_once(fake.client())

    assert fake.puts == []
    row = await DonationBuffer.get(legacy)
    assert row is not None and row.photos_linked is True
