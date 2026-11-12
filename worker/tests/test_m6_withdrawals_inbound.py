"""M6 withdrawals → shelter donations worker loop (draft CR — central warehouse M6 §1, §5)."""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from tent_model import M6ConfirmOutbox, M6Withdrawal

from worker.config import Settings
from worker.inbound import m6_withdrawals as m6
from worker.inbound.external_bookings import FailureTracker

NOW = "2026-11-12T05:00:00.000Z"
REF = "TENT-SH001-01JCWITHDRAW"
CODE = "WD-20261112-0001"
DONATION = f"donation:m6-{CODE}"
DB = "shelter_sh001"


class FakeCouch:
    """In-memory CouchDB: get/put/update/find/iter_all_docs/database_exists."""

    def __init__(self) -> None:
        self.dbs: dict[str, dict[str, dict[str, Any]]] = {}
        self.puts: list[tuple[str, str]] = []
        self.find_calls = 0

    def seed(self, db: str, doc: dict[str, Any]) -> None:
        self.dbs.setdefault(db, {})[doc["_id"]] = {**copy.deepcopy(doc), "_rev": "1-a"}

    async def database_exists(self, db: str) -> bool:
        return db in self.dbs

    async def iter_all_docs(self, db: str):
        for doc in list(self.dbs.get(db, {}).values()):
            yield copy.deepcopy(doc)

    async def get_doc(self, db: str, doc_id: str) -> dict[str, Any] | None:
        doc = self.dbs.get(db, {}).get(doc_id)
        return copy.deepcopy(doc) if doc else None

    async def put_doc(self, db: str, doc: dict[str, Any], **_: Any) -> dict[str, Any]:
        old = self.dbs.setdefault(db, {}).get(doc["_id"])
        n = int(old["_rev"].split("-")[0]) + 1 if old else 1
        self.dbs[db][doc["_id"]] = {**copy.deepcopy(doc), "_rev": f"{n}-x"}
        self.puts.append((db, doc["_id"]))
        return {"ok": True, "rev": f"{n}-x"}

    async def update_doc(self, db: str, doc_id: str, mutate: Any, **_: Any):
        current = await self.get_doc(db, doc_id)
        if current is None:
            return None
        changed = await mutate(current)
        if changed is None:
            return None
        res = await self.put_doc(db, changed)
        return {**changed, "_rev": res["rev"]}

    async def find(self, db: str, selector: dict[str, Any], **_: Any):
        self.find_calls += 1
        return [
            copy.deepcopy(d)
            for d in self.dbs.get(db, {}).values()
            if d.get("type") == selector.get("type")
            and d.get("ref_id") == selector.get("ref_id")
        ]


def line(code: str, name: str, qty: int, fulfilled: int | None, unit: str = "ชิ้น"):
    return {
        "item_code": code,
        "name": name,
        "unit": unit,
        "type_code": None,
        "qty": qty,
        "qty_fulfilled": fulfilled,
    }


def row(status: str, **over: Any) -> dict[str, Any]:
    return {
        "_id": REF,
        "shelter_code": "SH001",
        "request_code": CODE,
        "status": status,
        "source_warehouse_code": "WH01",
        "source_warehouse_name": "คลังกลางภาคใต้",
        "lines": [
            line("SKU-RICE", "ข้าวสาร", 20, 18, "ถุง"),
            line("M6-ONLY", "ผ้าห่ม", 5, 5),
            line("SKU-WATER", "น้ำดื่ม", 10, 0, "ขวด"),
        ],
        "reason": "ของขาด",
        "requested_by": {"name": "สมชาย", "username": "somchai"},
        "donation_id": None,
        "confirmed_at": None,
        "confirm_error": None,
        "rev": 2,
        "applied_rev": 1,
        **over,
    }


ITEM_MAP = {"SKU-RICE": "item_master:rice", "SKU-WATER": "item_master:water"}


# --- pure builders -------------------------------------------------------------------


def test_builds_donation_doc_from_fulfilled_lines_only() -> None:
    doc = m6.build_m6_donation_doc(row("in_transit"), ITEM_MAP, NOW)
    assert doc["_id"] == DONATION
    assert doc["type"] == "donation"
    assert doc["schema_v"] == 12
    assert doc["channel"] == "m6"
    assert doc["status"] == "verifying"
    assert doc["shelter_code"] == "SH001"
    assert doc["booking_ref"] == CODE
    assert doc["created_by"] == "m6:worker"
    assert "expires_at" not in doc
    assert "logistics" not in doc
    assert "tracking_token_hash" not in doc
    assert "campaign_id" not in doc
    # qty_fulfilled = 0 (water) is dropped; qty is what M6 sent, as a string.
    assert doc["items"] == [
        {
            "item_id": "item_master:rice",
            "qty": "18",
            "unit": "ถุง",
            "review_status": "approved",
        },
        {"free_text": "ผ้าห่ม", "qty": "5", "unit": "ชิ้น", "review_status": "approved"},
    ]


def test_donor_has_no_pii() -> None:
    doc = m6.build_m6_donation_doc(row("in_transit"), ITEM_MAP, NOW)
    assert doc["donor"] == {
        "name": "คลังกลาง M6 · คลังกลางภาคใต้",
        "phone": None,
        "phone_hash": "",
    }
    assert "somchai" not in str(doc) and "สมชาย" not in str(doc)


def test_donor_name_falls_back_to_warehouse_code() -> None:
    doc = m6.build_m6_donation_doc(
        row("in_transit", source_warehouse_name=None), ITEM_MAP, NOW
    )
    assert doc["donor"]["name"] == "คลังกลาง M6 · WH01"
    assert doc["external"]["source_warehouse_name"] is None


def test_external_block() -> None:
    confirmed = datetime(2026, 11, 12, 6, 0, tzinfo=UTC)
    doc = m6.build_m6_donation_doc(
        row("received", confirmed_at=confirmed, confirm_error="x"), ITEM_MAP, NOW
    )
    assert doc["external"] == {
        "system": "m6",
        "request_code": CODE,
        "external_ref": REF,
        "source_warehouse_code": "WH01",
        "source_warehouse_name": "คลังกลางภาคใต้",
        "confirmed_at": "2026-11-12T06:00:00.000Z",
        "confirm_error": "x",
    }


def test_patch_external_only_when_changed() -> None:
    doc = m6.build_m6_donation_doc(row("in_transit"), ITEM_MAP, NOW)
    assert m6.patch_external(doc, row("in_transit"), NOW) is None
    out = m6.patch_external(doc, row("in_transit", confirm_error="ยังไม่สำเร็จ"), NOW)
    assert out is not None
    assert out["external"]["confirm_error"] == "ยังไม่สำเร็จ"
    assert out["updated_at"] == NOW
    done = m6.patch_external(
        out, row("received", confirmed_at=datetime(2026, 11, 12, 6, tzinfo=UTC)), NOW
    )
    assert done is not None
    assert done["external"]["confirmed_at"] == "2026-11-12T06:00:00.000Z"
    assert done["external"]["confirm_error"] is None


def test_last_receiver_priority() -> None:
    assert m6.last_receiver({}) is None
    assert m6.last_receiver({}, ["a", "b"]) == {"name": "b", "username": "b"}
    with_points = {"point_receipts": [{"received_by": "p1"}, {"received_by": "p2"}]}
    assert m6.last_receiver(with_points, ["a"]) == {"name": "p2", "username": "p2"}
    closed = {**with_points, "received_summary": {"closed_by": "boss"}}
    assert m6.last_receiver(closed) == {"name": "boss", "username": "boss"}
    system = {**with_points, "received_summary": {"closed_by": "system"}}
    assert m6.last_receiver(system) == {"name": "p2", "username": "p2"}


def test_confirm_note_all_received() -> None:
    donation = {"received_summary": {"shortfalls": [], "items": [{"qty": "18"}]}}
    assert m6.confirm_note(donation) == "รับครบ"
    assert m6.confirm_note({}) == "รับครบ"


def test_confirm_note_nothing_received() -> None:
    donation = {
        "received_summary": {
            "nothing_received": True,
            "shortfalls": [
                {"item_id": "item_master:rice", "declared": "18", "counted": "0"}
            ],
        }
    }
    assert m6.confirm_note(donation) == "ไม่ได้รับของ"


def test_confirm_note_lists_shortfalls_and_rejected() -> None:
    donation = {
        "items": [{"item_id": "item_master:rice", "qty": "18", "unit": "ถุง"}],
        "received_summary": {
            "shortfalls": [
                {
                    "item_id": "item_master:rice",
                    "declared": "18",
                    "counted": "15",
                    "short": "3",
                }
            ],
            "items": [
                {"item_id": "item_master:rice", "qty": "15", "unit": "ถุง"},
                {
                    "free_text": "ผ้าห่ม",
                    "qty": "0",
                    "rejected": True,
                    "reject_reason": "เปียก",
                },
            ],
        },
    }
    names = {"item_master:rice": "ข้าวสาร"}
    assert (
        m6.confirm_note(donation, names)
        == "ขาด ข้าวสาร 3 ถุง (ส่ง 18 นับได้ 15); ไม่รับ ผ้าห่ม: เปียก"
    )


def test_names_by_item_id_pairs_matched_items_in_order() -> None:
    doc = m6.build_m6_donation_doc(row("in_transit"), ITEM_MAP, NOW)
    assert m6.names_by_item_id(row("in_transit"), doc) == {"item_master:rice": "ข้าวสาร"}


# --- loop with Mongo -----------------------------------------------------------------


async def _insert_row(**over: Any) -> None:
    now = datetime.now(UTC)
    doc = {**row(**({"status": "in_transit"} | over)), "fetched_at": now}
    await M6Withdrawal.get_pymongo_collection().insert_one(
        {
            **doc,
            "cancelled_at": None,
            "cancelled_by": None,
            "cancel_reason": None,
            "created_at": now,
            "updated_at": now,
        }
    )


async def _stored() -> dict[str, Any]:
    got = await M6Withdrawal.get_pymongo_collection().find_one({"_id": REF})
    assert got is not None
    return got


@pytest.fixture
def couch() -> FakeCouch:
    c = FakeCouch()
    c.seed(
        "catalog",
        {"_id": "item_master:rice-c", "type": "item_master", "sku": "SKU-RICE"},
    )
    c.seed(DB, {"_id": "item_master:rice", "type": "item_master", "sku": "SKU-RICE"})
    c.seed(
        DB,
        {
            "_id": "item_master:gone",
            "type": "item_master",
            "sku": "SKU-X",
            "deactivated": True,
        },
    )
    return c


async def test_loads_sku_map_shelter_overrides_central_and_skips_deactivated(
    couch: FakeCouch,
) -> None:
    got = await m6.load_item_map(couch, "SH001")  # type: ignore[arg-type]
    assert got == {"SKU-RICE": "item_master:rice"}


async def test_in_transit_creates_donation_and_links_it(
    db: None, couch: FakeCouch
) -> None:
    await _insert_row()
    assert await m6.apply_pending(couch, FailureTracker()) == 1  # type: ignore[arg-type]
    donation = couch.dbs[DB][DONATION]
    assert donation["channel"] == "m6"
    assert donation["items"][0]["item_id"] == "item_master:rice"
    assert donation["items"][1]["free_text"] == "ผ้าห่ม"
    stored = await _stored()
    assert stored["donation_id"] == DONATION
    assert stored["applied_rev"] == 2

    # Nothing left; a bumped rev with no change writes nothing more.
    puts = len(couch.puts)
    await M6Withdrawal.get_pymongo_collection().update_one(
        {"_id": REF}, {"$inc": {"rev": 1}}
    )
    assert await m6.apply_pending(couch, FailureTracker()) == 1  # type: ignore[arg-type]
    assert len(couch.puts) == puts


async def test_creation_is_idempotent_when_donation_already_exists(
    db: None, couch: FakeCouch
) -> None:
    existing = m6.build_m6_donation_doc(row("in_transit"), ITEM_MAP, NOW)
    existing["status"] = "received"  # staff already moved it on
    couch.seed(DB, existing)
    await _insert_row()
    await m6.apply_pending(couch, FailureTracker())  # type: ignore[arg-type]
    assert couch.puts == []
    assert couch.dbs[DB][DONATION]["status"] == "received"
    assert (await _stored())["donation_id"] == DONATION


@pytest.mark.parametrize(
    "status", ["issued", "rejected", "cancelled", "approved", "pending"]
)
async def test_other_statuses_create_no_donation(
    db: None, couch: FakeCouch, status: str
) -> None:
    await _insert_row(status=status)
    assert await m6.apply_pending(couch, FailureTracker()) == 1  # type: ignore[arg-type]
    assert DONATION not in couch.dbs[DB]
    stored = await _stored()
    assert stored["donation_id"] is None
    assert stored["applied_rev"] == 2


async def test_nothing_fulfilled_creates_no_donation(
    db: None, couch: FakeCouch
) -> None:
    await _insert_row(lines=[line("SKU-RICE", "ข้าวสาร", 20, 0)])
    await m6.apply_pending(couch, FailureTracker())  # type: ignore[arg-type]
    assert DONATION not in couch.dbs[DB]


async def test_confirm_fields_are_patched_onto_existing_donation(
    db: None, couch: FakeCouch
) -> None:
    await _insert_row()
    await m6.apply_pending(couch, FailureTracker())  # type: ignore[arg-type]
    await M6Withdrawal.get_pymongo_collection().update_one(
        {"_id": REF},
        {
            "$set": {"confirm_error": "ยังยืนยันไม่สำเร็จ"},
            "$inc": {"rev": 1},
        },
    )
    await m6.apply_pending(couch, FailureTracker())  # type: ignore[arg-type]
    assert couch.dbs[DB][DONATION]["external"]["confirm_error"] == "ยังยืนยันไม่สำเร็จ"

    confirmed = datetime(2026, 11, 12, 6, tzinfo=UTC)
    await M6Withdrawal.get_pymongo_collection().update_one(
        {"_id": REF},
        {
            "$set": {
                "confirm_error": None,
                "confirmed_at": confirmed,
                "status": "received",
            },
            "$inc": {"rev": 1},
        },
    )
    await m6.apply_pending(couch, FailureTracker())  # type: ignore[arg-type]
    external = couch.dbs[DB][DONATION]["external"]
    assert external["confirm_error"] is None
    assert external["confirmed_at"] == "2026-11-12T06:00:00.000Z"
    assert (await _stored())["applied_rev"] == 4


async def test_failed_write_keeps_row_pending(db: None, couch: FakeCouch) -> None:
    async def boom(*_: Any, **__: Any) -> Any:
        raise httpx.HTTPStatusError(
            "boom",
            request=httpx.Request("PUT", "http://c"),
            response=httpx.Response(500),
        )

    couch.put_doc = boom  # type: ignore[method-assign]
    await _insert_row()
    assert await m6.apply_pending(couch, FailureTracker()) == 0  # type: ignore[arg-type]
    stored = await _stored()
    assert stored["applied_rev"] == 1 and stored["donation_id"] is None


async def test_cas_keeps_newer_snapshot_pending(db: None, couch: FakeCouch) -> None:
    await _insert_row()
    original_update = couch.update_doc

    async def bump_then_update(*args: Any, **kwargs: Any) -> Any:
        # A newer snapshot lands while this one is being applied.
        await M6Withdrawal.get_pymongo_collection().update_one(
            {"_id": REF}, {"$inc": {"rev": 1, "applied_rev": 0}}
        )
        return await original_update(*args, **kwargs)

    couch.update_doc = bump_then_update  # type: ignore[method-assign]
    await m6.apply_pending(couch, FailureTracker())  # type: ignore[arg-type]
    stored = await _stored()
    assert stored["rev"] == 3
    assert stored["applied_rev"] == 2  # CAS matched on applied_rev; rev 3 still pending
    assert stored["rev"] > stored["applied_rev"]


# --- confirm outbox ------------------------------------------------------------------


async def _linked_row_with_received_donation(
    couch: FakeCouch, **donation_over: Any
) -> None:
    await _insert_row(donation_id=DONATION, applied_rev=2)
    donation = m6.build_m6_donation_doc(row("in_transit"), ITEM_MAP, NOW)
    couch.seed(DB, {**donation, **donation_over})


async def _outbox() -> list[dict[str, Any]]:
    return await M6ConfirmOutbox.get_pymongo_collection().find({}).to_list(None)


async def test_outbox_not_queued_until_donation_received(
    db: None, couch: FakeCouch
) -> None:
    await _linked_row_with_received_donation(couch)  # still `verifying`
    assert await m6.queue_confirmations(couch, FailureTracker()) == 0  # type: ignore[arg-type]
    assert await _outbox() == []


async def test_outbox_queued_once_with_receiver_and_all_received_note(
    db: None, couch: FakeCouch
) -> None:
    await _linked_row_with_received_donation(
        couch,
        status="received",
        point_receipts=[{"received_by": "staff1"}, {"received_by": "staff2"}],
        received_summary={"total_items": 2, "shortfalls": []},
    )
    assert await m6.queue_confirmations(couch, FailureTracker()) == 1  # type: ignore[arg-type]
    assert await m6.queue_confirmations(couch, FailureTracker()) == 0  # type: ignore[arg-type]
    rows = await _outbox()
    assert len(rows) == 1
    got = rows[0]
    assert got["_id"] == CODE
    assert got["external_ref"] == REF
    assert got["donation_id"] == DONATION
    assert got["shelter_code"] == "SH001"
    assert got["received_by"] == [{"name": "staff2", "username": "staff2"}]
    assert got["note"] == "รับครบ"
    assert got["done_at"] is None and got["attempts"] == 0


async def test_outbox_note_summarises_shortfall_with_m6_names(
    db: None, couch: FakeCouch
) -> None:
    await _linked_row_with_received_donation(
        couch,
        status="received",
        received_summary={
            "total_items": 2,
            "shortfalls": [
                {
                    "item_id": "item_master:rice",
                    "declared": "18",
                    "counted": "15",
                    "short": "3",
                }
            ],
        },
    )
    # No receipt on the doc → the ledger row's actor is the receiver.
    couch.seed(
        DB,
        {
            "_id": "ledger:1",
            "type": "stock_ledger",
            "ref_id": DONATION,
            "created_by": "counter1",
            "created_at": "2026-11-12T05:30:00Z",
        },
    )
    await m6.queue_confirmations(couch, FailureTracker())  # type: ignore[arg-type]
    got = (await _outbox())[0]
    assert got["note"] == "ขาด ข้าวสาร 3 ถุง (ส่ง 18 นับได้ 15)"
    assert got["received_by"] == [{"name": "counter1", "username": "counter1"}]


async def test_outbox_skipped_when_already_confirmed_or_queued(
    db: None, couch: FakeCouch
) -> None:
    await _linked_row_with_received_donation(
        couch, status="received", point_receipts=[{"received_by": "s"}]
    )
    await M6Withdrawal.get_pymongo_collection().update_one(
        {"_id": REF}, {"$set": {"confirmed_at": datetime.now(UTC)}}
    )
    assert await m6.queue_confirmations(couch, FailureTracker()) == 0  # type: ignore[arg-type]
    assert await _outbox() == []


async def test_outbox_falls_back_to_shelter_when_no_receiver_recorded(
    db: None, couch: FakeCouch
) -> None:
    await _linked_row_with_received_donation(couch, status="received")
    await m6.queue_confirmations(couch, FailureTracker())  # type: ignore[arg-type]
    assert (await _outbox())[0]["received_by"] == [
        {"name": "ศูนย์ SH001", "username": None}
    ]


# --- tick ----------------------------------------------------------------------------


async def test_tick_posts_sync_with_secret() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"polled": 0, "changed": 0})

    settings = Settings(
        couchdb_url="x",
        couchdb_user="x",
        couchdb_password="x",
        mongodb_uri="x",
        fastapi_url="http://fastapi:9000/",
        external_api_secret="svc",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        await m6.tick_sync(settings, http)
    assert str(seen[0].url) == "http://fastapi:9000/v1/integrations/m6/sync"
    assert seen[0].headers["Authorization"] == "Bearer svc"


async def test_tick_is_skipped_without_secret() -> None:
    settings = Settings(
        couchdb_url="x", couchdb_user="x", couchdb_password="x", mongodb_uri="x"
    )

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("must not call")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        await m6.tick_sync(settings, http)


def test_default_interval_is_45s() -> None:
    settings = Settings(
        couchdb_url="x", couchdb_user="x", couchdb_password="x", mongodb_uri="x"
    )
    assert settings.m6_sync_interval_s == 45.0
