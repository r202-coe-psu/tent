"""M5 transfers → referrals worker loop (draft CR — referral M5 integration §4, D7, D9)."""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from tent_model import M5Transfer

from worker.config import Settings
from worker.inbound import m5_transfers as m5
from worker.inbound.external_bookings import FailureTracker

NOW = "2026-11-11T05:00:00Z"
REF = "TENT-SH001-01JCBATCH"


class FakeCouch:
    """In-memory CouchDB with `_rev` bumps; enough for get/put/update_doc."""

    def __init__(self) -> None:
        self.dbs: dict[str, dict[str, dict[str, Any]]] = {}
        self.puts: list[tuple[str, str]] = []
        self.fail_put: set[str] = set()

    def seed(self, db: str, doc: dict[str, Any]) -> None:
        self.dbs.setdefault(db, {})[doc["_id"]] = {**copy.deepcopy(doc), "_rev": "1-a"}

    async def get_doc(self, db: str, doc_id: str) -> dict[str, Any] | None:
        doc = self.dbs.get(db, {}).get(doc_id)
        return copy.deepcopy(doc) if doc else None

    async def put_doc(self, db: str, doc: dict[str, Any], **_: Any) -> dict[str, Any]:
        if doc["_id"] in self.fail_put:
            raise httpx.HTTPStatusError(
                "boom",
                request=httpx.Request("PUT", "http://c"),
                response=httpx.Response(500),
            )
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


def referral(rid: str, evacuee: str, **over: Any) -> dict[str, Any]:
    return {
        "_id": f"referral:{rid}",
        "type": "referral",
        "schema_v": 3,
        "shelter_code": "SH001",
        "created_at": "2026-11-11T01:00:00Z",
        "updated_at": "2026-11-11T01:00:00Z",
        "created_by": "manager1",
        "evacuee_id": evacuee,
        "referral_type": "medical-emergency",
        "dispatch_mode": "m5",
        "batch_id": "01JCBATCH",
        "to_org": {"name": "รพ.สนาม", "kind": "hospital", "m5_facility_id": 6},
        "acuity": "red",
        "reason": "หายใจลำบาก",
        "urgency": "urgent",
        "status": "sent",
        "timeline": {"sent": {"at": "2026-11-11T02:00:00Z", "by": "manager1"}},
        "external": {
            "system": "m5",
            "external_ref": REF,
            "code": "TRF-20261111-0001",
            "status": "awaiting_review",
        },
        **over,
    }


def evacuee(eid: str, status: str = "active") -> dict[str, Any]:
    return {
        "_id": eid,
        "type": "evacuee",
        "schema_v": 9,
        "shelter_code": "SH001",
        "created_at": "x",
        "updated_at": "x",
        "created_by": "x",
        "current_stay": {"status": status, "zone": "A1", "since": "x"},
    }


def row(status: str, **over: Any) -> dict[str, Any]:
    return {
        "_id": REF,
        "batch_id": "01JCBATCH",
        "shelter_code": "SH001",
        "referral_ids": ["referral:A", "referral:B"],
        "code": "TRF-20261111-0001",
        "status": status,
        "destination": {"facility_id": 6, "name": "รพ.สนาม"},
        "original_destination": None,
        "review": {"note": "", "by": None, "at": None},
        "rev": 2,
        "applied_rev": 1,
        **over,
    }


# --- pure mapping --------------------------------------------------------------------


def test_awaiting_review_on_sent_changes_nothing() -> None:
    assert (
        m5.apply_row_to_referral(
            referral("A", "evacuee:A"), row("awaiting_review"), NOW
        )
        is None
    )


def test_pending_accepts_with_moph_review_and_new_destination() -> None:
    review = {"note": "รพ.เดิมเตียงเต็ม", "by": "สธ.จังหวัด", "at": "2026-11-11T03:00:00Z"}
    out = m5.apply_row_to_referral(
        referral("A", "evacuee:A"),
        row(
            "pending",
            review=review,
            destination={"facility_id": 2, "name": "รพ.ใหม่"},
            original_destination={"facility_id": 6, "name": "รพ.สนาม"},
        ),
        NOW,
    )
    assert out is not None
    assert out["status"] == "accepted"
    assert out["timeline"]["responded"] == {"at": review["at"], "by": "m5:สธ.จังหวัด"}
    assert out["response_reason"] == "รพ.เดิมเตียงเต็ม"
    assert out["to_org"] == {"name": "รพ.ใหม่", "kind": "hospital", "m5_facility_id": 2}
    assert out["external"]["original_m5_facility_id"] == 6
    assert out["external"]["status"] == "pending"


def test_rejected_maps_to_rejected() -> None:
    out = m5.apply_row_to_referral(
        referral("A", "evacuee:A"),
        row("rejected", review={"note": "ไม่รับ", "by": "สธ.", "at": "t"}),
        NOW,
    )
    assert out is not None and out["status"] == "rejected"
    assert out["response_reason"] == "ไม่รับ"


def test_arrived_closes_and_walks_through_accepted() -> None:
    out = m5.apply_row_to_referral(referral("A", "evacuee:A"), row("arrived"), NOW)
    assert out is not None
    assert out["status"] == "closed"
    assert "responded" in out["timeline"] and "closed" in out["timeline"]
    assert out["close_reason"] == m5.ARRIVED_CLOSE_REASON


def test_draft_is_repaired_to_sent_first_d7() -> None:
    draft = referral("A", "evacuee:A", status="draft", timeline={})
    draft.pop("external")
    out = m5.apply_row_to_referral(draft, row("awaiting_review"), NOW)
    assert out is not None
    assert out["status"] == "sent"
    assert out["timeline"]["sent"] == {"at": NOW, "by": m5.WORKER_ACTOR}
    assert out["external"]["code"] == "TRF-20261111-0001"


def test_closed_referral_keeps_status_but_mirrors_external() -> None:
    closed = referral("A", "evacuee:A", status="closed", close_reason="ถอนแล้ว")
    out = m5.apply_row_to_referral(closed, row("cancelled"), NOW)
    assert out is not None
    assert out["status"] == "closed" and out["close_reason"] == "ถอนแล้ว"
    assert out["external"]["status"] == "cancelled"


def test_rejected_never_flips_to_accepted() -> None:
    rejected = referral("A", "evacuee:A", status="rejected")
    out = m5.apply_row_to_referral(rejected, row("pending"), NOW)
    assert out is None or out["status"] == "rejected"


# --- loop with Mongo -----------------------------------------------------------------


async def _insert_row(**over: Any) -> None:
    now = datetime.now(UTC)
    doc = {**row(**({"status": "awaiting_review"} | over)), "fetched_at": now}
    await M5Transfer.get_pymongo_collection().insert_one(
        {**doc, "patients": [], "activity": [], "created_at": now, "updated_at": now}
    )


async def _applied_rev() -> int:
    got = await M5Transfer.get_pymongo_collection().find_one({"_id": REF})
    assert got is not None
    return got["applied_rev"]


@pytest.fixture
def couch() -> FakeCouch:
    c = FakeCouch()
    c.seed("central_ops", referral("A", "evacuee:A"))
    c.seed("central_ops", referral("B", "evacuee:B"))
    c.seed("shelter_sh001", evacuee("evacuee:A"))
    c.seed("shelter_sh001", evacuee("evacuee:B", status="checked_out"))
    return c


async def test_apply_pending_writes_and_marks_applied(
    db: None, couch: FakeCouch
) -> None:
    await _insert_row(status="pending", review={"note": "", "by": "สธ.", "at": "t"})
    assert await m5.apply_pending(couch, FailureTracker()) == 1
    assert couch.dbs["central_ops"]["referral:A"]["status"] == "accepted"
    assert couch.dbs["central_ops"]["referral:B"]["status"] == "accepted"
    assert await _applied_rev() == 2
    # Nothing left to apply; a second pass writes nothing.
    puts = len(couch.puts)
    assert await m5.apply_pending(couch, FailureTracker()) == 0
    assert len(couch.puts) == puts


async def test_in_transit_writes_one_leave_movement_d9(
    db: None, couch: FakeCouch
) -> None:
    couch.dbs["central_ops"]["referral:A"]["status"] = "accepted"
    couch.dbs["central_ops"]["referral:B"]["status"] = "accepted"
    await _insert_row(status="in_transit")
    await m5.apply_pending(couch, FailureTracker())

    shelter = couch.dbs["shelter_sh001"]
    movement = shelter[m5.leave_movement_id("referral:A")]
    assert movement["action"] == "leave_temporary"
    assert movement["created_by"] == m5.WORKER_ACTOR
    assert movement["shelter_code"] == "SH001"
    assert movement["zone"] == "A1"
    assert shelter["evacuee:A"]["current_stay"]["status"] == "temporary_leave"
    # B was already checked out: no movement, stay untouched.
    assert m5.leave_movement_id("referral:B") not in shelter
    assert shelter["evacuee:B"]["current_stay"]["status"] == "checked_out"

    # Re-applying the same snapshot (rev bumped by an unrelated change) adds nothing.
    await M5Transfer.get_pymongo_collection().update_one(
        {"_id": REF}, {"$inc": {"rev": 1}}
    )
    movements_before = [k for k in shelter if k.startswith("movement:")]
    await m5.apply_pending(couch, FailureTracker())
    assert [k for k in shelter if k.startswith("movement:")] == movements_before


async def test_failed_write_keeps_row_pending(db: None, couch: FakeCouch) -> None:
    couch.fail_put.add("referral:B")
    await _insert_row(status="pending")
    assert await m5.apply_pending(couch, FailureTracker()) == 0
    assert await _applied_rev() == 1


async def test_tick_posts_sync_with_secret() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"skipped": True, "checked": 0, "changed": 0})

    settings = Settings(
        couchdb_url="x",
        couchdb_user="x",
        couchdb_password="x",
        mongodb_uri="x",
        fastapi_url="http://fastapi:9000/",
        external_api_secret="svc",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        await m5.tick_sync(settings, http)
    assert str(seen[0].url) == "http://fastapi:9000/v1/integrations/m5/sync"
    assert seen[0].headers["Authorization"] == "Bearer svc"


async def test_tick_is_skipped_without_secret() -> None:
    settings = Settings(
        couchdb_url="x", couchdb_user="x", couchdb_password="x", mongodb_uri="x"
    )

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("must not call")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        await m5.tick_sync(settings, http)
