"""EXT-008–010 — partner booking create / cancel / status (M2, CR-154 C3/C4)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from pymongo.errors import DuplicateKeyError
from tent_model.external_booking import ExternalBooking
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.third_party_access_log import ThirdPartyAccessLog

from apiapp.modules.thirdparty_auth.scopes import mint_access_token
from apiapp.utils.masking import national_id_hash

URL = "/external/bookings"


def _valid_cid(prefix: str) -> str:
    total = sum(int(prefix[i]) * (13 - i) for i in range(12))
    return prefix + str((11 - total % 11) % 10)


CID = _valid_cid("190980012345")  # 1909800123458
PHONE = "081-234-5678"


def _bearer(
    scopes: list[str], module_name: str | None = "M2", client_id: str = "m2-test"
) -> dict[str, str]:
    token, _ = mint_access_token(client_id=client_id, module_name=module_name, scopes=scopes)
    return {"Authorization": f"Bearer {token}"}


GRANTED = _bearer(["booking-write"])
OTHER_CLIENT = _bearer(["booking-write"], client_id="other-client")


def _payload(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "location_code": "SH001",
        "cid": CID,
        "first_name": "  สมชาย ",
        "last_name": "ใจดี",
        "phone": PHONE,
    }
    body.update(overrides)
    return {k: v for k, v in body.items() if v is not None}


async def _shelter(
    code: str = "SH001",
    *,
    status: str = "open",
    is_active: bool = True,
    raw_data: dict[str, Any] | None = None,
) -> PublicShelter:
    return await PublicShelter(
        id=code,
        shelter_code=code,
        name=f"ศูนย์ {code}",
        status=status,
        location_status=status,
        is_active=is_active,
        capacity=100,
        raw_data=raw_data or {},
        updated_at=datetime.now(UTC),
    ).insert()


@pytest.fixture
async def shelters() -> None:
    await _shelter("SH001")
    await _shelter("SH002")


async def _person(
    *, shelter_code: str = "SH001", status: str = "active", person_id: str | None = None
) -> PublicPerson:
    return await PublicPerson(
        id=person_id or f"evacuee:{shelter_code}-{status}",
        shelter_code=shelter_code,
        first_name="สมชาย",
        last_name_masked="ใ.",
        national_id_hash=national_id_hash(CID),
        status=status,
        updated_at=datetime.now(UTC),
    ).insert()


async def _booking(
    *,
    state: str = "pending",
    client_id: str = "m2-test",
    evacuee_id: str | None = None,
    cancel_requested: bool = False,
    reject_reason: str | None = None,
    booking_id: str = "BK-TEST0001",
) -> ExternalBooking:
    now = datetime(2026, 8, 20, 7, 30, tzinfo=UTC)
    pii = state == "pending"
    return await ExternalBooking(
        id=booking_id,
        booking_id=booking_id,
        client_id=client_id,
        module_name="M2",
        shelter_code="SH001",
        cid=CID if pii else None,
        cid_hash=national_id_hash(CID),
        first_name="สมชาย" if pii else None,
        last_name="ใจดี" if pii else None,
        phone="0812345678" if pii else None,
        state=state,
        cancel_requested=cancel_requested,
        reject_reason=reject_reason,
        evacuee_id=evacuee_id,
        created_at=now,
        updated_at=now,
    ).insert()


async def _log_statuses() -> list[str]:
    return [log.status for log in await ThirdPartyAccessLog.find_all().to_list()]


# --- EXT-008 ----------------------------------------------------------------------


async def test_requires_bearer_token(client: AsyncClient) -> None:
    """401 (not 404) also proves the route is mounted — auto-discovery swallows ImportError."""
    response = await client.post(URL, json=_payload())
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_token"


async def test_missing_scope_is_403_and_logged(client: AsyncClient, shelters: None) -> None:
    response = await client.post(URL, json=_payload(), headers=_bearer(["residency-read"]))
    assert response.status_code == 403
    assert response.json()["code"] == "insufficient_scope"

    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [log.status for log in logs] == ["denied_insufficient_scope"]
    assert logs[0].endpoint == "EXT-008"
    assert await ExternalBooking.find_all().count() == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"cid": "1909800123456"},  # bad checksum
        {"cid": "190980012345"},  # 12 digits
        {"cid": "19098001234ab"},
        {"phone": "12345"},
        {"phone": "1812345678"},
        {"first_name": "   "},
        {"last_name": ""},
    ],
)
async def test_invalid_body_is_422_and_logged(
    client: AsyncClient, shelters: None, overrides: dict[str, Any]
) -> None:
    response = await client.post(URL, json=_payload(**overrides), headers=GRANTED)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert await _log_statuses() == ["denied_validation_error"]
    assert await ExternalBooking.find_all().count() == 0


async def test_missing_field_is_422(client: AsyncClient, shelters: None) -> None:
    body = _payload()
    del body["phone"]
    response = await client.post(URL, json=body, headers=GRANTED)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert "phone" in response.json()["message"]
    assert await _log_statuses() == ["denied_validation_error"]


async def test_unknown_shelter_is_404(client: AsyncClient, shelters: None) -> None:
    response = await client.post(URL, json=_payload(location_code="NOPE"), headers=GRANTED)
    assert response.status_code == 404
    assert response.json()["code"] == "location_not_found"
    assert await _log_statuses() == ["denied_location_not_found"]


async def test_inactive_shelter_is_404(client: AsyncClient) -> None:
    await _shelter("SH001", is_active=False)
    response = await client.post(URL, json=_payload(), headers=GRANTED)
    assert response.status_code == 404
    assert response.json()["code"] == "location_not_found"


async def test_closed_shelter_is_409(client: AsyncClient) -> None:
    await _shelter("SH001", status="closed")
    response = await client.post(URL, json=_payload(), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "location_not_bookable"
    assert await _log_statuses() == ["denied_location_not_bookable"]


async def test_pre_registration_opt_out_is_409(client: AsyncClient) -> None:
    await _shelter("SH001", raw_data={"feature_flags": {"accepts_pre_registration": False}})
    response = await client.post(URL, json=_payload(), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "location_not_bookable"


@pytest.mark.parametrize("shelter_status", ["full", "full_capacity"])
async def test_full_shelter_is_bookable(client: AsyncClient, shelter_status: str) -> None:
    await _shelter("SH001", status=shelter_status)
    response = await client.post(URL, json=_payload(), headers=GRANTED)
    assert response.status_code == 201


async def test_create_happy_path(client: AsyncClient, shelters: None) -> None:
    response = await client.post(URL, json=_payload(phone="+66812345678"), headers=GRANTED)
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == 201
    assert body["message"] == "Booking accepted."
    result = body["result"]
    assert result["booking_id"].startswith("BK-")
    assert result["location_code"] == "SH001"
    assert result["booking_status"] == "BOOKED"

    booking = await ExternalBooking.get(result["booking_id"])
    assert booking is not None
    assert booking.booking_id == result["booking_id"]
    assert booking.state == "pending"
    assert booking.client_id == "m2-test"
    assert booking.module_name == "M2"
    assert booking.shelter_code == "SH001"
    assert booking.cid == CID
    assert booking.cid_hash == national_id_hash(CID)
    assert booking.first_name == "สมชาย"
    assert booking.last_name == "ใจดี"
    assert booking.phone == "0812345678"

    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert len(logs) == 1
    log = logs[0]
    assert (log.endpoint, log.status, log.location_code, log.result_count) == (
        "EXT-008",
        "granted",
        "SH001",
        1,
    )
    assert log.module_name == "M2"
    dumped = str(log.model_dump())
    for secret in (CID, "0812345678", "สมชาย", "ใจดี"):
        assert secret not in dumped


async def test_duplicate_via_projected_hold_is_409(client: AsyncClient, shelters: None) -> None:
    await _person(status="pre_registered")
    response = await client.post(URL, json=_payload(), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_booking"
    assert await _log_statuses() == ["denied_duplicate_booking"]


async def test_duplicate_via_pending_buffer_is_409(client: AsyncClient, shelters: None) -> None:
    first = await client.post(URL, json=_payload(), headers=GRANTED)
    assert first.status_code == 201
    second = await client.post(URL, json=_payload(), headers=OTHER_CLIENT)
    assert second.status_code == 409
    assert second.json()["code"] == "duplicate_booking"


async def test_same_cid_other_shelter_is_201(client: AsyncClient, shelters: None) -> None:
    await _person(shelter_code="SH001", status="active")
    first = await client.post(URL, json=_payload(location_code="SH001"), headers=GRANTED)
    assert first.status_code == 409
    second = await client.post(URL, json=_payload(location_code="SH002"), headers=GRANTED)
    assert second.status_code == 201


async def test_checked_out_person_same_shelter_is_201(client: AsyncClient, shelters: None) -> None:
    await _person(status="checked_out")
    response = await client.post(URL, json=_payload(), headers=GRANTED)
    assert response.status_code == 201


async def test_cancelled_buffer_row_does_not_block(client: AsyncClient, shelters: None) -> None:
    await _booking(state="cancelled")
    response = await client.post(URL, json=_payload(), headers=GRANTED)
    assert response.status_code == 201


async def test_concurrent_creates_yield_one_booking(client: AsyncClient, shelters: None) -> None:
    responses = await asyncio.gather(
        client.post(URL, json=_payload(), headers=GRANTED),
        client.post(URL, json=_payload(), headers=GRANTED),
    )
    assert sorted(r.status_code for r in responses) == [201, 409]
    conflict = next(r for r in responses if r.status_code == 409)
    assert conflict.json()["code"] == "duplicate_booking"
    assert await ExternalBooking.find_all().count() == 1


# --- EXT-009 ----------------------------------------------------------------------


def _cancel_url(booking_id: str = "BK-TEST0001") -> str:
    return f"{URL}/{booking_id}/cancel"


async def test_cancel_pending_clears_pii(client: AsyncClient) -> None:
    await _booking(state="pending")
    response = await client.post(_cancel_url(), json={"reason": "เปลี่ยนแผน"}, headers=GRANTED)
    assert response.status_code == 200
    assert response.json()["result"] == {
        "booking_id": "BK-TEST0001",
        "booking_status": "CANCELLED",
    }

    booking = await ExternalBooking.get("BK-TEST0001")
    assert booking is not None
    assert booking.state == "cancelled"
    assert booking.cancel_reason == "เปลี่ยนแผน"
    assert (booking.cid, booking.first_name, booking.last_name, booking.phone) == (
        None,
        None,
        None,
        None,
    )
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [(log.endpoint, log.status) for log in logs] == [("EXT-009", "granted")]


async def test_cancel_without_body(client: AsyncClient) -> None:
    await _booking(state="pending")
    response = await client.post(_cancel_url(), headers=GRANTED)
    assert response.status_code == 200


async def test_cancel_reason_too_long_is_422(client: AsyncClient) -> None:
    await _booking(state="pending")
    response = await client.post(_cancel_url(), json={"reason": "x" * 201}, headers=GRANTED)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert await _log_statuses() == ["denied_validation_error"]


async def test_cancel_requires_scope(client: AsyncClient) -> None:
    await _booking(state="pending")
    response = await client.post(_cancel_url(), headers=_bearer(["residency-read"]))
    assert response.status_code == 403
    assert await _log_statuses() == ["denied_insufficient_scope"]


async def test_cancel_written_pre_registered_requests_cancel(client: AsyncClient) -> None:
    await _person(status="pre_registered", person_id="evacuee:01JTEST")
    await _booking(state="written", evacuee_id="evacuee:01JTEST")
    response = await client.post(_cancel_url(), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    assert response.json()["result"]["booking_status"] == "CANCELLED"

    booking = await ExternalBooking.get("BK-TEST0001")
    assert booking is not None
    assert booking.state == "written"
    assert booking.cancel_requested is True
    assert booking.cancel_reason == "r"


async def test_cancel_written_without_projection_requests_cancel(client: AsyncClient) -> None:
    await _booking(state="written", evacuee_id="evacuee:01JNOTYET")
    response = await client.post(_cancel_url(), headers=GRANTED)
    assert response.status_code == 200
    booking = await ExternalBooking.get("BK-TEST0001")
    assert booking is not None and booking.cancel_requested is True


async def test_cancel_written_after_check_in_is_409(client: AsyncClient) -> None:
    await _person(status="active", person_id="evacuee:01JTEST")
    await _booking(state="written", evacuee_id="evacuee:01JTEST")
    response = await client.post(_cancel_url(), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    booking = await ExternalBooking.get("BK-TEST0001")
    assert booking is not None and booking.cancel_requested is False
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_by_other_client_is_404(client: AsyncClient) -> None:
    await _booking(state="pending")
    response = await client.post(_cancel_url(), headers=OTHER_CLIENT)
    assert response.status_code == 404
    assert response.json()["code"] == "booking_not_found"
    booking = await ExternalBooking.get("BK-TEST0001")
    assert booking is not None and booking.state == "pending"


async def test_cancel_twice_is_409(client: AsyncClient) -> None:
    await _booking(state="pending")
    first = await client.post(_cancel_url(), headers=GRANTED)
    assert first.status_code == 200
    second = await client.post(_cancel_url(), headers=GRANTED)
    assert second.status_code == 409
    assert second.json()["code"] == "booking_not_cancellable"


@pytest.mark.parametrize(("state", "cancel_requested"), [("rejected", False), ("written", True)])
async def test_cancel_terminal_is_409(
    client: AsyncClient, state: str, cancel_requested: bool
) -> None:
    await _booking(state=state, cancel_requested=cancel_requested)
    response = await client.post(_cancel_url(), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"


# --- EXT-010 ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("state", "cancel_requested", "expected"),
    [
        ("pending", False, "BOOKED"),
        ("written", False, "BOOKED"),
        ("written", True, "CANCELLED"),
        ("cancelled", False, "CANCELLED"),
        ("rejected", False, "REJECTED"),
    ],
)
async def test_status_mapping(
    client: AsyncClient, state: str, cancel_requested: bool, expected: str
) -> None:
    reject_reason = "duplicate" if state == "rejected" else None
    await _booking(state=state, cancel_requested=cancel_requested, reject_reason=reject_reason)
    response = await client.get(f"{URL}/BK-TEST0001", headers=GRANTED)
    assert response.status_code == 200
    assert response.json()["result"] == {
        "booking_id": "BK-TEST0001",
        "location_code": "SH001",
        "booking_status": expected,
        "reject_reason": reject_reason,
        "created_at": "2026-08-20T14:30:00+07:00",
        "updated_at": "2026-08-20T14:30:00+07:00",
    }
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [(log.endpoint, log.status) for log in logs] == [("EXT-010", "granted")]


async def test_status_other_client_is_404(client: AsyncClient) -> None:
    await _booking(state="pending")
    response = await client.get(f"{URL}/BK-TEST0001", headers=OTHER_CLIENT)
    assert response.status_code == 404
    assert response.json()["code"] == "booking_not_found"
    assert await _log_statuses() == ["denied_booking_not_found"]


async def test_status_unknown_is_404(client: AsyncClient) -> None:
    response = await client.get(f"{URL}/BK-NOPE", headers=GRANTED)
    assert response.status_code == 404
    assert response.json()["code"] == "booking_not_found"


async def test_unique_index_guards_open_bookings(client: AsyncClient) -> None:
    """The create race guard relies on the unique partial index existing after startup."""
    await _booking(state="pending", booking_id="BK-A")
    with pytest.raises(DuplicateKeyError):
        await _booking(state="written", booking_id="BK-B")
    await _booking(state="cancelled", booking_id="BK-C")
