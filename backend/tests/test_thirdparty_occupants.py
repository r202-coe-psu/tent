"""EXT-007 — partner occupant list tests (partner ODT, ADR 0002 §6; full mode CR-257)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.public_shelter import PublicShelter
from tent_model.shelter_occupant import ShelterOccupant
from tent_model.third_party_access_log import ThirdPartyAccessLog

from apiapp.modules.thirdparty_auth.scopes import mint_access_token


def _bearer(scopes: list[str]) -> dict[str, str]:
    token, _ = mint_access_token(client_id="m7-test", module_name="M7", scopes=scopes)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def shelter() -> PublicShelter:
    return await PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์ทดสอบ",
        status="open",
        location_status="open",
        is_active=True,
        capacity=100,
        updated_at=datetime.now(UTC),
    ).insert()


async def test_get_occupants_requires_bearer_token(client: AsyncClient) -> None:
    response = await client.get(
        "/external/locations/SH001/occupants", params={"purpose": "medical-referral"}
    )
    assert response.status_code == 401


async def test_get_occupants_missing_purpose_returns_400(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    headers = _bearer([])
    response = await client.get("/external/locations/SH001/occupants", headers=headers)
    assert response.status_code == 400
    body = response.json()
    assert body["status"] == 400
    assert body["code"] == "missing_purpose"


async def test_get_occupants_denied_by_default(client: AsyncClient, shelter: PublicShelter) -> None:
    """ODT: every module defaults to no `occupancy-pii-read` — always 403 today."""
    headers = _bearer(["location-read", "occupancy-read"])  # no occupancy-pii-read
    response = await client.get(
        "/external/locations/SH001/occupants",
        headers=headers,
        params={"purpose": "medical-referral"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["status"] == 403
    assert body["code"] == "insufficient_scope"
    assert "detail" in body


async def test_get_occupants_denial_persists_access_log_row(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    headers = _bearer([])
    response = await client.get(
        "/external/locations/SH001/occupants",
        headers=headers,
        params={"purpose": "medical-referral"},
    )
    assert response.status_code == 403

    rows = await ThirdPartyAccessLog.find(ThirdPartyAccessLog.location_code == "SH001").to_list()
    assert len(rows) == 1
    row = rows[0]
    assert row.client_id == "m7-test"
    assert row.module_name == "M7"
    assert row.endpoint == "EXT-007"
    assert row.purpose == "medical-referral"
    assert row.status == "denied_insufficient_scope"
    assert row.ip


async def test_get_occupants_missing_purpose_also_logs_the_attempt(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    headers = _bearer([])
    await client.get("/external/locations/SH001/occupants", headers=headers)

    rows = await ThirdPartyAccessLog.find(ThirdPartyAccessLog.location_code == "SH001").to_list()
    assert len(rows) == 1
    assert rows[0].status == "denied_missing_purpose"
    assert rows[0].purpose == ""


async def test_get_occupants_with_scope_returns_empty_when_no_occupants(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    headers = _bearer(["occupancy-pii-read"])
    response = await client.get(
        "/external/locations/SH001/occupants",
        headers=headers,
        params={"purpose": "medical-referral"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["result"] == []
    assert "pagination" in body
    assert body["pagination"]["total"] == 0

    rows = await ThirdPartyAccessLog.find(ThirdPartyAccessLog.location_code == "SH001").to_list()
    assert rows[0].status == "granted"
    assert rows[0].result_count == 0


async def test_get_occupants_with_scope_returns_real_data_and_pagination(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    now = datetime.now(UTC)
    await ShelterOccupant(
        id="SH001:occ1",
        shelter_code="SH001",
        occupant_ref="OCC-0001-0042",
        name_masked="สมชาย ใ.",
        age_range="60+",
        gender="male",
        care_flags=["bedridden"],
        checked_in_at=now,
        updated_at=now,
    ).insert()
    await ShelterOccupant(
        id="SH001:occ2",
        shelter_code="SH001",
        occupant_ref="OCC-0001-0043",
        name_masked="มาลี ส.",
        age_range="20-59",
        gender="female",
        care_flags=[],
        checked_in_at=now,
        updated_at=now,
    ).insert()

    headers = _bearer(["occupancy-pii-read"])
    response = await client.get(
        "/external/locations/SH001/occupants",
        headers=headers,
        params={"purpose": "medical-referral", "page": 1, "limit": 1},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["result"]) == 1
    assert data["result"][0]["occupant_ref"] == "OCC-0001-0042"
    assert data["result"][0]["name_masked"] == "สมชาย ใ."
    assert data["result"][0]["age_range"] == "60+"
    assert data["result"][0]["gender"] == "male"
    assert data["result"][0]["care_flags"] == ["bedridden"]
    assert "pagination" in data
    assert data["pagination"]["page"] == 1
    assert data["pagination"]["limit"] == 1
    assert data["pagination"]["total"] == 2
    assert data["pagination"]["total_pages"] == 2

    # Page 2
    p2_resp = await client.get(
        "/external/locations/SH001/occupants",
        headers=headers,
        params={"purpose": "medical-referral", "page": 2, "limit": 1},
    )
    assert p2_resp.status_code == 200
    p2_data = p2_resp.json()
    assert len(p2_data["result"]) == 1
    assert p2_data["result"][0]["occupant_ref"] == "OCC-0001-0043"
    assert p2_data["pagination"]["page"] == 2

    rows = await ThirdPartyAccessLog.find(ThirdPartyAccessLog.location_code == "SH001").to_list()
    assert len(rows) == 2
    assert all(r.status == "granted" for r in rows)
    assert rows[0].result_count == 1


# CR-257 — plaintext rows: masked for `occupancy-pii-read`, whole with `pii-full` too ─────────

URL = "/external/locations/SH001/occupants"
PURPOSE = {"purpose": "eoc-handover"}


async def _plain_occupant() -> ShelterOccupant:
    """A PROJECTION_VERSION 23 row: plaintext, no `name_masked`."""
    now = datetime.now(UTC)
    return await ShelterOccupant(
        id="SH001:plain",
        shelter_code="SH001",
        occupant_ref="OCC-PLAIN",
        first_name="สมชาย",
        last_name="ใจดี",
        age=67,
        national_id="0012345678901",
        id_card_type="pink_card",
        phone="0811111111",
        age_range="60+",
        gender="male",
        care_flags=["bedridden"],
        checked_in_at=now,
        updated_at=now,
    ).insert()


async def test_masked_mode_masks_plaintext_rows_like_before(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    await _plain_occupant()

    response = await client.get(URL, headers=_bearer(["occupancy-pii-read"]), params=PURPOSE)
    assert response.status_code == 200
    (item,) = response.json()["result"]
    assert item["name_masked"] == "สมชาย ใ."
    for key in ("first_name", "last_name", "name", "age", "national_id", "phone"):
        assert key not in item
    for plaintext in ("ใจดี", "0012345678901", "0811111111"):
        assert plaintext not in response.text
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["granted"]


async def test_full_mode_returns_whole_values(client: AsyncClient, shelter: PublicShelter) -> None:
    await _plain_occupant()

    response = await client.get(
        URL, headers=_bearer(["occupancy-pii-read", "pii-full"]), params=PURPOSE
    )
    assert response.status_code == 200
    (item,) = response.json()["result"]
    assert item["first_name"] == "สมชาย"
    assert item["last_name"] == "ใจดี"
    assert item["name"] == "สมชาย ใจดี"
    assert item["age"] == 67
    assert item["national_id"] == "0012345678901"
    assert item["passport_id"] is None
    assert item["id_card_type"] == "pink_card"
    assert item["phone"] == "0811111111"
    # The masked fields stay for clients that already read them.
    assert item["name_masked"] == "สมชาย ใ."
    assert item["age_range"] == "60+"
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["granted_full"]
    assert logs[0].result_count == 1


async def test_pii_full_alone_grants_nothing(client: AsyncClient, shelter: PublicShelter) -> None:
    await _plain_occupant()

    response = await client.get(URL, headers=_bearer(["pii-full"]), params=PURPOSE)
    assert response.status_code == 403
    assert "0012345678901" not in response.text
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["denied_insufficient_scope"]


async def test_full_mode_never_falls_back_to_masked_values(
    client: AsyncClient, shelter: PublicShelter
) -> None:
    """A row projected before PROJECTION_VERSION 23: plaintext fields are `null`."""
    now = datetime.now(UTC)
    await ShelterOccupant(
        id="SH001:legacy",
        shelter_code="SH001",
        occupant_ref="OCC-LEGACY",
        name_masked="มาลี ส.",
        age_range="20-59",
        updated_at=now,
    ).insert()

    response = await client.get(
        URL, headers=_bearer(["occupancy-pii-read", "pii-full"]), params=PURPOSE
    )
    assert response.status_code == 200
    (item,) = response.json()["result"]
    assert item["name_masked"] == "มาลี ส."
    assert item["name"] is None
    assert item["last_name"] is None
    assert item["national_id"] is None
    assert item["age"] is None
