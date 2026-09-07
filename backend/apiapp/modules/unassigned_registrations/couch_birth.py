"""Couch SoR birth for claimed Unassigned Registration members (CR-113 / #247)."""

from __future__ import annotations

from copy import deepcopy
from typing import Protocol

import httpx
from fastapi import HTTPException, status

from ...core.config import settings

_COUCH_TIMEOUT_SECONDS = 15.0


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
