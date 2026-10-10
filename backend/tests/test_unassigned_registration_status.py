"""Public ticket status (BFF sync) — service secret, status-only, no PII."""

from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient
from tent_model.unassigned_registration import (
    PersonId,
    UnassignedHousehold,
    UnassignedMember,
    UnassignedRegistration,
)

from apiapp.utils.ulid import new_ulid

_PII_KEYS = {
    "first_name",
    "last_name",
    "phone",
    "person_id",
    "members",
    "household",
    "address_no",
    "label",
    "open_phones",
    "open_person_id_numbers",
}


def _member(status: str, first_name: str) -> UnassignedMember:
    return UnassignedMember(
        reserved_evacuee_id=f"evacuee:{new_ulid()}",
        status=status,
        first_name=first_name,
        last_name="ใจดี",
        gender="male",
        phone="0812345678",
        person_id=PersonId(cardType="national_id", number="1234567890123"),
        country="THAILAND",
    )


async def _seed(*, doc_status: str, member_statuses: list[str]) -> UnassignedRegistration:
    doc = UnassignedRegistration(
        id=new_ulid(),
        schema_v=3,
        reserved_household_id=f"household:{new_ulid()}",
        members=[_member(s, f"สมาชิก{i}") for i, s in enumerate(member_statuses)],
        household=UnassignedHousehold(
            housing_type="owned_house",
            address_no="123/45",
            subdistrict="คอหงส์",
            district="หาดใหญ่",
            province="สงขลา",
            postal_code="90110",
            label="ครอบครัวใจดี",
        ),
        status=doc_status,
        registered_via="web",
        created_at=datetime.now(UTC),
    )
    await doc.insert()
    return doc


async def test_status_requires_service_bearer(client: AsyncClient) -> None:
    response = await client.get(f"/public/v1/unassigned-registrations/{new_ulid()}/status")
    assert response.status_code == 401


async def test_status_404_for_unknown_id(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    response = await client.get(
        f"/public/v1/unassigned-registrations/{new_ulid()}/status", headers=auth_headers
    )
    assert response.status_code == 404
    assert response.json()["errors"][0]["error"]["code"] == "NOT_FOUND"


async def test_status_open_doc_is_not_claimed(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed(doc_status="open", member_statuses=["open", "open"])
    response = await client.get(
        f"/public/v1/unassigned-registrations/{doc.id}/status", headers=auth_headers
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "id": doc.id,
        "status": "open",
        "members_total": 2,
        "members_claimed": 0,
        "claimed": False,
    }


async def test_status_partial_claim_stays_pending(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed(doc_status="open", member_statuses=["claimed", "open"])
    response = await client.get(
        f"/public/v1/unassigned-registrations/{doc.id}/status", headers=auth_headers
    )
    assert response.status_code == 200
    body = response.json()
    assert body["members_claimed"] == 1
    assert body["claimed"] is False


async def test_status_closed_with_claimed_member_is_claimed(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed(doc_status="closed", member_statuses=["claimed", "claimed"])
    response = await client.get(
        f"/public/v1/unassigned-registrations/{doc.id}/status", headers=auth_headers
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "closed"
    assert body["members_claimed"] == 2
    assert body["claimed"] is True


async def test_status_closed_all_cancelled_is_not_claimed(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed(doc_status="closed", member_statuses=["cancelled", "cancelled"])
    response = await client.get(
        f"/public/v1/unassigned-registrations/{doc.id}/status", headers=auth_headers
    )
    assert response.status_code == 200
    body = response.json()
    assert body["members_claimed"] == 0
    assert body["claimed"] is False


async def test_status_response_has_no_pii(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    doc = await _seed(doc_status="closed", member_statuses=["claimed"])
    response = await client.get(
        f"/public/v1/unassigned-registrations/{doc.id}/status", headers=auth_headers
    )
    body = response.json()
    assert set(body) == {"id", "status", "members_total", "members_claimed", "claimed"}
    assert not (_PII_KEYS & set(body))
    raw = response.text
    for needle in ("สมาชิก0", "ใจดี", "0812345678", "1234567890123", "123/45"):
        assert needle not in raw
