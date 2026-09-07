"""Couch SoR birth for claimed Unassigned Registration members (CR-113 / #247)."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from typing import Protocol

import httpx
from fastapi import HTTPException, status
from tent_model.unassigned_registration import UnassignedMember, UnassignedRegistration

from ...core.config import settings

_COUCH_TIMEOUT_SECONDS = 15.0
_RELIGION_ALLOWED = frozenset({"buddhist", "muslim", "christian", "other", "unknown"})
# Couch SoR schema versions at claim birth (CR-112 / schema.md) — keep local to birth.
HOUSEHOLD_SCHEMA_V = 5
EVACUEE_SCHEMA_V = 10


class CouchBirthError(Exception):
    """Raised when shelter Couch write fails during claim."""


class CouchBirthPort(Protocol):
    async def birth(
        self,
        *,
        shelter_code: str,
        household_doc: dict,
        evacuee_docs: list[dict],
        cookie_header: str | None,
    ) -> None:
        """Write household (if absent) + evacuees into shelter_{code}."""


def shelter_db_name(shelter_code: str) -> str:
    return f"shelter_{shelter_code.lower()}"


def _iso(ts: datetime) -> str:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return ts.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _household_label(doc: UnassignedRegistration, head: UnassignedMember) -> str:
    if doc.household.label and doc.household.label.strip():
        return doc.household.label.strip()
    joined = f"{head.first_name} {head.last_name}".strip()
    return f"ครอบครัว{joined}" if joined else "ครอบครัวผู้ลงทะเบียนล่วงหน้า"


def build_couch_household(
    doc: UnassignedRegistration,
    head: UnassignedMember,
    shelter_code: str,
    actor: str,
    now: datetime,
) -> dict:
    hh = doc.household
    ts = _iso(now)
    return {
        "_id": doc.reserved_household_id,
        "type": "household",
        "schema_v": HOUSEHOLD_SCHEMA_V,
        "shelter_code": shelter_code,
        "created_at": ts,
        "updated_at": ts,
        "created_by": actor,
        "label": _household_label(doc, head),
        "head_evacuee_id": head.reserved_evacuee_id,
        "status": "pre_registered",
        "checkout_destination": None,
        "municipality_zone": None,
        "community": None,
        "pets": [
            {
                "species": pet.species,
                "count": pet.count,
                **({"notes": pet.notes} if pet.notes else {}),
                "has_cage": pet.has_cage,
            }
            for pet in hh.pets
        ],
        "assets": None,
        "vehicles": [],
        "housing_type": hh.housing_type,
        "residence_landmark": hh.residence_landmark,
        "address_no": hh.address_no,
        "village_no": hh.village_no,
        "subdistrict": hh.subdistrict,
        "district": hh.district,
        "province": hh.province,
        "postal_code": hh.postal_code,
    }


def build_couch_evacuee(
    member: UnassignedMember,
    household_id: str,
    shelter_code: str,
    actor: str,
    now: datetime,
    doc: UnassignedRegistration,
) -> dict:
    ts = _iso(now)
    person_id = None
    if member.person_id is not None:
        person_id = {
            "cardType": member.person_id.cardType,
            "number": member.person_id.number,
        }
    registered_via = doc.registered_via if doc.registered_via in {"web", "staff"} else "web"
    body: dict = {
        "_id": member.reserved_evacuee_id,
        "type": "evacuee",
        "schema_v": EVACUEE_SCHEMA_V,
        "shelter_code": shelter_code,
        "created_at": ts,
        "updated_at": ts,
        "created_by": actor,
        "first_name": member.first_name,
        "last_name": member.last_name or "",
        "gender": member.gender,
        "phone": member.phone,
        "country": member.country or "THAILAND",
        "vulnerable_groups": list(member.vulnerable_groups),
        "special_needs": list(member.special_needs),
        "household_id": household_id,
        "current_stay": {
            "status": "pre_registered",
            "zone": None,
            "since": ts,
        },
        "privacy": {"search_excluded": False},
        "registered_via": registered_via,
    }
    if person_id is not None:
        body["person_id"] = person_id
    if member.birth_year is not None:
        body["birth_year"] = member.birth_year
    if member.age is not None:
        body["age"] = member.age
    if member.nickname:
        body["nickname"] = member.nickname
    if member.religion and member.religion in _RELIGION_ALLOWED:
        body["religion"] = member.religion
    return body


class HttpCouchBirth:
    """Birth Couch docs using the caller's AuthSession cookie (shelter-scoped write)."""

    async def birth(
        self,
        *,
        shelter_code: str,
        household_doc: dict,
        evacuee_docs: list[dict],
        cookie_header: str | None,
    ) -> None:
        couch_url = (settings.COUCHDB_URL or "").rstrip("/")
        if not couch_url:
            raise CouchBirthError("COUCHDB_URL is not configured")
        if not cookie_header:
            raise CouchBirthError("Staff session cookie required for Couch birth")

        db = shelter_db_name(shelter_code)
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Cookie": cookie_header,
        }

        try:
            async with httpx.AsyncClient(timeout=_COUCH_TIMEOUT_SECONDS) as client:
                household_id = household_doc["_id"]
                existing = await client.get(f"{couch_url}/{db}/{household_id}", headers=headers)
                docs: list[dict] = list(evacuee_docs)
                if existing.status_code == 404:
                    docs.insert(0, household_doc)
                elif existing.status_code >= 400:
                    raise CouchBirthError(
                        f"Could not read household in {db}: HTTP {existing.status_code}"
                    )

                response = await client.post(
                    f"{couch_url}/{db}/_bulk_docs",
                    headers=headers,
                    json={"docs": docs},
                )
        except httpx.HTTPError as exc:
            raise CouchBirthError(f"Couch birth request failed: {exc}") from exc

        if response.status_code >= 400:
            raise CouchBirthError(f"Couch bulk write failed: HTTP {response.status_code}")

        try:
            results = response.json()
        except ValueError as exc:
            raise CouchBirthError("Couch bulk write returned invalid JSON") from exc

        if not isinstance(results, list):
            raise CouchBirthError("Couch bulk write returned unexpected payload")

        # conflict on reserved id = already born (idempotent enough for retry).
        hard = [
            row
            for row in results
            if isinstance(row, dict) and row.get("error") and row.get("error") != "conflict"
        ]
        if hard:
            detail = ", ".join(
                f"{row.get('id')}={row.get('error')}:{row.get('reason')}" for row in hard
            )
            raise CouchBirthError(f"Couch bulk write row failures: {detail}")


class InMemoryCouchBirth:
    """Test double — records born docs per shelter without talking to Couch."""

    def __init__(self) -> None:
        self._docs: dict[str, dict[str, dict]] = {}
        self.write_counts: dict[str, dict[str, int]] = {}
        self.fail_next: CouchBirthError | None = None

    def docs_for(self, shelter_code: str) -> dict[str, dict]:
        return dict(self._docs.get(shelter_code, {}))

    async def birth(
        self,
        *,
        shelter_code: str,
        household_doc: dict,
        evacuee_docs: list[dict],
        cookie_header: str | None,
    ) -> None:
        if self.fail_next is not None:
            err = self.fail_next
            self.fail_next = None
            raise err

        shelter_docs = self._docs.setdefault(shelter_code, {})
        counts = self.write_counts.setdefault(shelter_code, {})
        household_id = household_doc["_id"]
        if household_id not in shelter_docs:
            shelter_docs[household_id] = deepcopy(household_doc)
            counts[household_id] = counts.get(household_id, 0) + 1
        for doc in evacuee_docs:
            doc_id = doc["_id"]
            if doc_id in shelter_docs:
                continue
            shelter_docs[doc_id] = deepcopy(doc)
            counts[doc_id] = counts.get(doc_id, 0) + 1


def get_couch_birth() -> CouchBirthPort:
    return HttpCouchBirth()


def couch_unavailable(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": {
                "code": "ONLINE_REQUIRED",
                "message": message,
            }
        },
    )
