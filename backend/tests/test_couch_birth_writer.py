"""CR-260 FR-C1/FR-C10 — Couch birth stamps the claimer as `updated_by` on every doc.

The shelter `_design/access` rule rejects a non-admin write whose `updated_by` is set and
is not the session user. The claim writes with the claimer's AuthSession cookie, so a doc
that still names its previous writer (the pet-append merge of an existing household) would
fail the whole claim. CouchDB is faked with `httpx.MockTransport`, enforcing that rule.
"""

from __future__ import annotations

import json

import httpx
import pytest

from apiapp.core.config import settings
from apiapp.modules.unassigned_registrations.couch_birth import (
    CouchBirthError,
    CouchImagePayload,
    HttpCouchBirth,
)

SESSION_USER = "reg01"
DB = "shelter_sh001"


class FakeShelterCouch:
    """One shelter DB whose writes pass the CR-260 `updated_by` VDU rule or are rejected."""

    def __init__(self, session_user: str) -> None:
        self.session_user = session_user
        self.docs: dict[str, dict] = {}
        self.bulk_bodies: list[list[dict]] = []

    def _vdu(self, doc: dict) -> str | None:
        writer = doc.get("updated_by")
        if writer is not None and writer != self.session_user:
            return "updated_by must match the authenticated user"
        return None

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix(f"/{DB}/")
        if request.method == "GET":
            doc = self.docs.get(path)
            return httpx.Response(200, json=doc) if doc else httpx.Response(404, json={})
        if request.method == "POST" and path == "_bulk_docs":
            docs = json.loads(request.content)["docs"]
            self.bulk_bodies.append(docs)
            rows = []
            for doc in docs:
                reason = self._vdu(doc)
                if reason:
                    rows.append({"id": doc["_id"], "error": "forbidden", "reason": reason})
                    continue
                generation = int(doc.get("_rev", "0-x").split("-")[0]) + 1
                self.docs[doc["_id"]] = {**doc, "_rev": f"{generation}-fake"}
                rows.append({"id": doc["_id"], "ok": True, "rev": f"{generation}-fake"})
            return httpx.Response(201, json=rows)
        if request.method == "PUT":  # attachment
            doc_id = path.split("/")[0]
            generation = int(self.docs[doc_id]["_rev"].split("-")[0]) + 1
            self.docs[doc_id]["_rev"] = f"{generation}-fake"
            return httpx.Response(201, json={"ok": True, "rev": f"{generation}-fake"})
        return httpx.Response(405, json={})


@pytest.fixture(autouse=True)
def _couch_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "COUCHDB_URL", "http://couch.test")


def _household(**extra: object) -> dict:
    return {"_id": "household:01", "type": "household", "created_by": SESSION_USER, **extra}


async def test_pet_append_onto_a_household_last_written_by_someone_else() -> None:
    couch = FakeShelterCouch(SESSION_USER)
    couch.docs["household:01"] = {
        **_household(created_by="intake01", pets=[{"name": "เดิม"}]),
        "_rev": "3-old",
        "updated_by": "intake01",
    }

    await HttpCouchBirth(httpx.MockTransport(couch.handler)).birth(
        shelter_code="SH001",
        household_doc=_household(updated_at="2026-11-25T00:00:00Z"),
        evacuee_docs=[{"_id": "evacuee:01", "type": "evacuee", "created_by": SESSION_USER}],
        cookie_header="AuthSession=abc",
        writer=SESSION_USER,
        append_pets=[{"name": "ใหม่"}],
    )

    household = couch.docs["household:01"]
    assert household["updated_by"] == SESSION_USER
    assert household["created_by"] == "intake01"
    assert [pet["name"] for pet in household["pets"]] == ["เดิม", "ใหม่"]
    assert couch.docs["evacuee:01"]["updated_by"] == SESSION_USER


async def test_every_doc_in_the_batch_names_the_claimer() -> None:
    couch = FakeShelterCouch(SESSION_USER)
    image = CouchImagePayload(
        doc={"_id": "image:01", "type": "image", "created_by": SESSION_USER},
        full_bytes=b"full",
        thumb_bytes=b"thumb",
        content_type="image/webp",
    )
    evacuee = {"_id": "evacuee:01", "type": "evacuee", "created_by": SESSION_USER}

    await HttpCouchBirth(httpx.MockTransport(couch.handler)).birth(
        shelter_code="SH001",
        household_doc=_household(),
        evacuee_docs=[evacuee],
        cookie_header="AuthSession=abc",
        writer=SESSION_USER,
        image_payloads=[image],
    )

    sent = couch.bulk_bodies[0]
    assert [doc["_id"] for doc in sent] == ["household:01", "evacuee:01", "image:01"]
    assert {doc["updated_by"] for doc in sent} == {SESSION_USER}
    # The caller's dicts are not mutated.
    assert "updated_by" not in evacuee and "updated_by" not in image.doc


async def test_a_writer_other_than_the_session_user_is_still_rejected() -> None:
    # The stamp must be the cookie's user; anything else is what the VDU guards against.
    couch = FakeShelterCouch(SESSION_USER)

    with pytest.raises(CouchBirthError, match="forbidden"):
        await HttpCouchBirth(httpx.MockTransport(couch.handler)).birth(
            shelter_code="SH001",
            household_doc=_household(),
            evacuee_docs=[],
            cookie_header="AuthSession=abc",
            writer="mallory",
        )
