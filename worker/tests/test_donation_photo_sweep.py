"""CR-175 donor photos FR-16 / FR-16a / AC-7 / AC-11 — the unbound donor photo sweep."""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest

from worker.couch.client import CouchClient
from worker.retention.donation_photos import (
    ORPHAN_PHOTO_INDEX,
    sweep_shelter_orphan_photos,
)

DB = "shelter_sh001"
NOW = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)
OLD = "2026-10-26T11:59:59.999Z"  # just over 24 h before NOW
FRESH = "2026-10-26T12:00:00.001Z"  # just under


def image(n: int, created_at: str, **over) -> dict:
    return {
        "_id": f"image:01K8PHXTX{n:017d}",
        "type": "image",
        "schema_v": 2,
        "created_at": created_at,
        **over,
    }


class FakeCouch:
    """`_find` that honours the sweep's selector, `_bulk_docs` deletes with `_rev` checks."""

    def __init__(self, docs: list[dict]):
        self.docs = {d["_id"]: copy.deepcopy(d) for d in docs}
        self.revs = dict.fromkeys(self.docs, 1)
        self.find_bodies: list[dict] = []
        self.between_find_and_delete = None

    def client(self) -> CouchClient:
        settings = MagicMock(
            couch_base_url="http://couch:5984", couchdb_user="a", couchdb_password="b"
        )
        client = CouchClient(settings)
        client._client = httpx.AsyncClient(
            base_url="http://couch:5984", transport=httpx.MockTransport(self.handle)
        )
        return client

    def matches(self, doc: dict, selector: dict) -> bool:
        for field, cond in selector.items():
            if isinstance(cond, dict) and "$exists" in cond:
                if (field in doc) != cond["$exists"]:
                    return False
            elif isinstance(cond, dict) and "$lt" in cond:
                if not (field in doc and doc[field] < cond["$lt"]):
                    return False
            elif doc.get(field) != cond:
                return False
        return True

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.strip("/").split("/", 1)[1]
        body = json.loads(request.content)
        if path == "_find":
            self.find_bodies.append(body)
            rows = [
                {"_id": d["_id"], "_rev": f"{self.revs[d['_id']]}-x"}
                for d in self.docs.values()
                if self.matches(d, body["selector"])
            ][: body["limit"]]
            if self.between_find_and_delete:
                self.between_find_and_delete()
                self.between_find_and_delete = None
            return httpx.Response(200, json={"docs": rows})
        assert path == "_bulk_docs"
        results = []
        for doc in body["docs"]:
            if doc["_rev"] != f"{self.revs[doc['_id']]}-x":
                results.append({"id": doc["_id"], "error": "conflict"})
                continue
            del self.docs[doc["_id"]]
            results.append({"id": doc["_id"], "rev": "deleted"})
        return httpx.Response(201, json=results)


async def sweep(fake: FakeCouch) -> int:
    return await sweep_shelter_orphan_photos(fake.client(), DB, now=NOW)


@pytest.mark.asyncio
async def test_removes_an_unbound_donor_photo_older_than_24h():
    fake = FakeCouch([image(1, OLD, purpose="donation")])

    assert await sweep(fake) == 1
    assert fake.docs == {}


@pytest.mark.asyncio
async def test_keeps_what_the_sweep_must_never_touch():
    keep = [
        image(1, FRESH, purpose="donation"),  # not 24 h old yet
        image(2, OLD, purpose="donation", donation_id="donation:A"),  # FR-16a, AC-7
        image(3, OLD),  # kiosk / booking / claim / staff photo (AC-11)
    ]
    fake = FakeCouch([*keep, image(4, OLD, purpose="donation")])

    assert await sweep(fake) == 1
    assert sorted(fake.docs) == sorted(d["_id"] for d in keep)


@pytest.mark.asyncio
async def test_asks_couchdb_for_the_partial_index_with_its_own_filter():
    fake = FakeCouch([])

    await sweep(fake)

    (body,) = fake.find_bodies
    assert body["use_index"] == ORPHAN_PHOTO_INDEX
    assert body["selector"] == {
        "type": "image",
        "purpose": "donation",
        "donation_id": {"$exists": False},
        "created_at": {"$lt": "2026-10-26T12:00:00.000Z"},
    }


@pytest.mark.asyncio
async def test_a_photo_bound_between_read_and_delete_survives():
    photo = image(1, OLD, purpose="donation")
    fake = FakeCouch([photo])

    def worker_binds_it():
        fake.docs[photo["_id"]]["donation_id"] = "donation:A"
        fake.revs[photo["_id"]] += 1

    fake.between_find_and_delete = worker_binds_it

    assert await sweep(fake) == 0
    assert fake.docs[photo["_id"]]["donation_id"] == "donation:A"


@pytest.mark.asyncio
async def test_pages_through_more_than_one_batch():
    fake = FakeCouch([image(n, OLD, purpose="donation") for n in range(450)])

    assert await sweep(fake) == 450
    assert fake.docs == {}
    assert len(fake.find_bodies) == 3


def test_names_the_index_the_frontend_deploys():
    source = (
        Path(__file__).resolve().parents[2]
        / "frontend/src/lib/server/shelter-access-design.ts"
    ).read_text(encoding="utf-8")
    ddoc, name = ORPHAN_PHOTO_INDEX
    assert f"ddoc: '{ddoc}'" in source
    assert f"name: '{name}'" in source
