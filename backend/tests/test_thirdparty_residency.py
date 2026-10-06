"""EXT-011 — partner shelter-residency lookup tests (M2, CR-154 FR-40..45)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.third_party_access_log import ThirdPartyAccessLog

from apiapp.modules.thirdparty_auth.scopes import mint_access_token
from apiapp.utils.masking import national_id_hash

URL = "/external/persons/shelter-residency"
CID = "1909800123456"


def _bearer(scopes: list[str], module_name: str | None = "M2") -> dict[str, str]:
    token, _ = mint_access_token(client_id="m2-test", module_name=module_name, scopes=scopes)
    return {"Authorization": f"Bearer {token}"}


GRANTED = _bearer(["residency-read"])


@pytest.fixture
async def shelters() -> list[PublicShelter]:
    now = datetime.now(UTC)
    docs = [
        PublicShelter(
            id=code,
            shelter_code=code,
            name=name,
            status="open",
            location_status="open",
            is_active=True,
            capacity=100,
            updated_at=now,
        )
        for code, name in (("SH001", "ศูนย์หนึ่ง"), ("SH002", "ศูนย์สอง"))
    ]
    for doc in docs:
        await doc.insert()
    return docs


async def _person(
    *,
    shelter_code: str = "SH001",
    status: str = "active",
    checked_in_at: datetime | None = datetime(2026, 8, 20, 7, 30, tzinfo=UTC),
    updated_at: datetime | None = None,
    suffix: str = "01",
) -> PublicPerson:
    return await PublicPerson(
        id=f"evacuee:{shelter_code}{suffix}",
        shelter_code=shelter_code,
        first_name="สมชาย",
        last_name_masked="ใ.",
        national_id_hash=national_id_hash(CID),
        checked_in_at=checked_in_at,
        status=status,
        updated_at=updated_at or datetime.now(UTC),
    ).insert()


async def test_requires_bearer_token(client: AsyncClient) -> None:
    """401 (not 404) also proves the route is mounted — auto-discovery swallows ImportError."""
    response = await client.get(URL, params={"cid": CID, "purpose": "m2-check"})
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_token"


async def test_missing_purpose_is_400_and_logged(client: AsyncClient) -> None:
    response = await client.get(URL, params={"cid": CID}, headers=GRANTED)
    assert response.status_code == 400
    assert response.json()["code"] == "missing_purpose"

    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["denied_missing_purpose"]
    assert logs[0].endpoint == "EXT-011"


async def test_missing_scope_is_403_and_logged(client: AsyncClient) -> None:
    response = await client.get(
        URL, params={"cid": CID, "purpose": "m2-check"}, headers=_bearer(["location-read"])
    )
    assert response.status_code == 403
    assert response.json()["code"] == "insufficient_scope"

    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["denied_insufficient_scope"]


@pytest.mark.parametrize("cid", ["12345", "19098001234ab", ""])
async def test_invalid_cid_is_422(client: AsyncClient, cid: str) -> None:
    response = await client.get(URL, params={"cid": cid, "purpose": "m2-check"}, headers=GRANTED)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_checked_in_returns_bangkok_time(
    client: AsyncClient, shelters: list[PublicShelter]
) -> None:
    await _person(status="room_confirmed")
    response = await client.get(URL, params={"cid": CID, "purpose": "m2-check"}, headers=GRANTED)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == 200
    assert body["result"] == {
        "location_code": "SH001",
        "name_th": "ศูนย์หนึ่ง",
        "checkin_datetime": "2026-08-20T14:30:00+07:00",
        "residency_status": "CHECKED_IN",
        "stay_status": "room_confirmed",
        "in_zone": True,
    }


async def test_checked_out_maps_to_checked_out(
    client: AsyncClient, shelters: list[PublicShelter]
) -> None:
    await _person(status="checked_out")
    response = await client.get(URL, params={"cid": CID, "purpose": "m2-check"}, headers=GRANTED)
    assert response.status_code == 200
    assert response.json()["result"]["residency_status"] == "CHECKED_OUT"


@pytest.mark.parametrize(
    ("status", "checked_in_at"),
    [("pre_registered", datetime(2026, 8, 20, tzinfo=UTC)), ("active", None)],
)
async def test_not_resident_is_404(
    client: AsyncClient,
    shelters: list[PublicShelter],
    status: str,
    checked_in_at: datetime | None,
) -> None:
    await _person(status=status, checked_in_at=checked_in_at)
    response = await client.get(URL, params={"cid": CID, "purpose": "m2-check"}, headers=GRANTED)
    assert response.status_code == 404
    assert response.json()["code"] == "residency_not_found"


async def test_unknown_cid_is_404(client: AsyncClient) -> None:
    response = await client.get(URL, params={"cid": CID, "purpose": "m2-check"}, headers=GRANTED)
    assert response.status_code == 404
    assert response.json()["code"] == "residency_not_found"


async def test_present_record_wins_over_newer_checked_out(
    client: AsyncClient, shelters: list[PublicShelter]
) -> None:
    """FR-43 — duplicates across shelters are allowed; Present stay is reported first."""
    now = datetime.now(UTC)
    await _person(shelter_code="SH001", status="active", updated_at=now - timedelta(days=2))
    await _person(shelter_code="SH002", status="checked_out", updated_at=now, suffix="02")
    response = await client.get(URL, params={"cid": CID, "purpose": "m2-check"}, headers=GRANTED)
    assert response.status_code == 200
    assert response.json()["result"]["location_code"] == "SH001"


async def test_latest_record_wins_when_none_present(
    client: AsyncClient, shelters: list[PublicShelter]
) -> None:
    now = datetime.now(UTC)
    await _person(shelter_code="SH001", status="checked_out", updated_at=now - timedelta(days=2))
    await _person(shelter_code="SH002", status="transferred", updated_at=now, suffix="02")
    response = await client.get(URL, params={"cid": CID, "purpose": "m2-check"}, headers=GRANTED)
    assert response.status_code == 200
    assert response.json()["result"]["location_code"] == "SH002"


async def test_granted_call_is_logged_without_cid(
    client: AsyncClient, shelters: list[PublicShelter]
) -> None:
    await _person()
    await client.get(
        URL,
        params={"cid": CID, "purpose": "m2-check"},
        headers=_bearer(["residency-read"], module_name=None),
    )
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert len(logs) == 1
    log = logs[0]
    assert log.status == "granted"
    assert log.location_code == "SH001"
    assert log.purpose == "m2-check"
    assert log.result_count == 1
    assert log.module_name is None
    assert CID not in log.model_dump_json()
