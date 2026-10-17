"""EXT-008–010 — partner booking create / cancel / status (M2, CR-154 C3/C4)."""

from __future__ import annotations

import asyncio
import logging
import traceback
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from pymongo.errors import BulkWriteError, DuplicateKeyError
from tent_model.external_booking import ExternalBooking
from tent_model.public_person import PublicPerson
from tent_model.public_shelter import PublicShelter
from tent_model.third_party_access_log import ThirdPartyAccessLog

from apiapp.modules.thirdparty_auth.scopes import ThirdPartyClaims, mint_access_token
from apiapp.modules.thirdparty_bookings.schemas import BookingCreateRequest
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
    row_id: str | None = None,
    cid: str = CID,
    person_seq: int = 0,
    group_size: int = 1,
    committed: bool = True,
    created_at: datetime | None = None,
) -> ExternalBooking:
    now = created_at or datetime(2026, 8, 20, 7, 30, tzinfo=UTC)
    pii = state == "pending"
    return await ExternalBooking(
        id=row_id or booking_id,
        booking_id=booking_id,
        person_seq=person_seq,
        group_size=group_size,
        committed=committed,
        client_id=client_id,
        module_name="M2",
        shelter_code="SH001",
        cid=cid if pii else None,
        cid_hash=national_id_hash(cid),
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


def _group_payload(count: int, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "location_code": "SH001",
        "persons": [
            {
                "cid": _cid(i),
                "first_name": f"ชื่อ{i}",
                "last_name": "ใจดี",
                "phone": f"08{i:08d}",
            }
            for i in range(count)
        ],
    }
    body.update(overrides)
    return body


def _cid(i: int) -> str:
    """Distinct valid CIDs — `i` fills the 12-digit prefix (starts with 1)."""
    return _valid_cid(f"1{i:011d}")


async def _group(
    count: int,
    states: list[str] | None = None,
    *,
    booking_id: str = "BK-GROUP001",
    client_id: str = "m2-test",
    committed: bool = True,
) -> list[ExternalBooking]:
    return [
        await _booking(
            state=(states or ["pending"] * count)[i],
            booking_id=booking_id,
            row_id=f"BP-{booking_id}-{i}",
            cid=_cid(i),
            person_seq=i,
            group_size=count,
            client_id=client_id,
            committed=committed,
            evacuee_id=f"evacuee:{booking_id}-{i}",
        )
        for i in range(count)
    ]


async def _assert_one_internal_error_log() -> None:
    """The 500 paths are audited like every other attempt: one row, no PII, count 0."""
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [(log.endpoint, log.status, log.result_count) for log in logs] == [
        ("EXT-008", "denied_internal_error", 0)
    ]
    dumped = str(logs[0].model_dump())
    for secret in _PII:
        assert secret not in dumped


def _assert_sanitized_500(response: Any) -> None:
    """The commit-failure 500 is the same partner `internal_error` body as an insert failure."""
    assert response.status_code == 500
    body = response.json()
    assert body["code"] == "internal_error"
    assert body["message"] == "The booking could not be saved."
    assert body["status"] == 500
    for leak in ("boom", "matched", "CommitShortfallError", "RuntimeError", *_PII):
        assert leak not in response.text


async def _rows(booking_id: str | None = None) -> list[dict[str, Any]]:
    query = {"booking_id": booking_id} if booking_id else {}
    cursor = ExternalBooking.get_pymongo_collection().find(query).sort("person_seq")
    return await cursor.to_list()


async def _log_statuses() -> list[str]:
    return [log.status for log in await ThirdPartyAccessLog.find_all().to_list()]


def _chain_text(exc: BaseException) -> str:
    """Everything a log handler could print for `exc` and every exception chained to it."""
    parts: list[str] = []
    seen: set[int] = set()
    pending: list[BaseException | None] = [exc]
    while pending:
        current = pending.pop()
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        parts.append(f"{type(current).__name__} {current!r} {current}")
        parts.append("".join(traceback.format_exception(current)))
        pending += [current.__cause__, current.__context__, *getattr(current, "exceptions", ())]
    return "\n".join(parts)


def _chain_has_bulk_write_error(exc: BaseException) -> bool:
    seen: set[int] = set()
    pending: list[BaseException | None] = [exc]
    while pending:
        current = pending.pop()
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, BulkWriteError):
            return True
        pending += [current.__cause__, current.__context__, *getattr(current, "exceptions", ())]
    return False


_PII = (CID, "0812345678", "081-234-5678", "สมชาย", "ใจดี")


async def _drain_detached() -> None:
    """Wait for detached cleanup / log tasks that outlive a cancelled request."""
    from apiapp.modules.thirdparty_bookings import use_case

    while use_case._detached_tasks:
        await asyncio.gather(*list(use_case._detached_tasks), return_exceptions=True)


def _create_directly(body: dict[str, Any]) -> Any:
    from apiapp.modules.thirdparty_bookings.use_case import ThirdPartyBookingsUseCase

    claims = ThirdPartyClaims(client_id="m2-test", module_name="M2", scopes=["booking-write"])
    return ThirdPartyBookingsUseCase().create_booking(
        body=BookingCreateRequest.model_validate(body), claims=claims, client_ip="127.0.0.1"
    )


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
    assert logs[0].result_count == 0
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
    assert result["persons_count"] == 1

    booking = await ExternalBooking.find_one(ExternalBooking.booking_id == result["booking_id"])
    assert booking is not None
    assert booking.id.startswith("BP-")
    assert (booking.person_seq, booking.group_size, booking.committed) == (0, 1, True)
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


async def test_create_group_of_three(client: AsyncClient, shelters: None) -> None:
    response = await client.post(URL, json=_group_payload(3), headers=GRANTED)
    assert response.status_code == 201
    result = response.json()["result"]
    assert result["persons_count"] == 3
    assert result["booking_status"] == "BOOKED"

    rows = await _rows(result["booking_id"])
    assert [row["person_seq"] for row in rows] == [0, 1, 2]
    assert {row["group_size"] for row in rows} == {3}
    assert {row["committed"] for row in rows} == {True}
    assert {row["state"] for row in rows} == {"pending"}
    assert len({row["_id"] for row in rows}) == 3
    assert all(row["_id"].startswith("BP-") for row in rows)
    assert [row["cid"] for row in rows] == [_cid(0), _cid(1), _cid(2)]
    assert await _rows() == rows  # nothing else was written

    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [(log.endpoint, log.status, log.result_count) for log in logs] == [
        ("EXT-008", "granted", 3)
    ]
    dumped = str(logs[0].model_dump())
    for secret in (_cid(0), _cid(1), "ชื่อ0", "ใจดี", "080000000"):
        assert secret not in dumped


async def test_create_group_upper_bound_is_100(client: AsyncClient, shelters: None) -> None:
    response = await client.post(URL, json=_group_payload(100), headers=GRANTED)
    assert response.status_code == 201
    assert response.json()["result"]["persons_count"] == 100
    assert len(await _rows(response.json()["result"]["booking_id"])) == 100


@pytest.mark.parametrize("count", [101, 1000])
async def test_create_group_over_cap_is_422(
    client: AsyncClient, shelters: None, count: int
) -> None:
    """Above the use-case cap but within the schema bound: same 422 and access log row."""
    response = await client.post(URL, json=_group_payload(count), headers=GRANTED)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["message"] == "persons must contain between 1 and 100 items."
    assert await _log_statuses() == ["denied_validation_error"]
    assert await _rows() == []


async def test_create_group_beyond_schema_bound_is_422(client: AsyncClient, shelters: None) -> None:
    """Above the schema hard bound the body is rejected before the use case runs."""
    response = await client.post(URL, json=_group_payload(1001), headers=GRANTED)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["message"].startswith("body.persons: ")
    assert await _rows() == []


async def test_empty_persons_is_422(client: AsyncClient, shelters: None) -> None:
    response = await client.post(URL, json=_group_payload(0), headers=GRANTED)
    assert response.status_code == 422
    assert "between 1 and 100" in response.json()["message"]
    assert await _log_statuses() == ["denied_validation_error"]


async def test_both_shapes_is_422(client: AsyncClient, shelters: None) -> None:
    body = _group_payload(1, cid=CID)
    response = await client.post(URL, json=body, headers=GRANTED)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert await _log_statuses() == ["denied_validation_error"]
    assert await _rows() == []


async def test_repeated_cid_in_group_is_422(client: AsyncClient, shelters: None) -> None:
    body = _group_payload(3)
    body["persons"][2]["cid"] = body["persons"][0]["cid"]
    response = await client.post(URL, json=body, headers=GRANTED)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert "persons[2].cid duplicates persons[0].cid" in response.json()["message"]
    assert _cid(0) not in response.text
    assert await _log_statuses() == ["denied_validation_error"]
    assert await _rows() == []


async def test_group_422_reports_every_bad_person(client: AsyncClient, shelters: None) -> None:
    body = _group_payload(5)
    del body["persons"][1]["phone"]
    body["persons"][3]["cid"] = "1909800123456"  # bad checksum
    body["persons"][4]["phone"] = "12345"
    response = await client.post(URL, json=body, headers=GRANTED)
    assert response.status_code == 422
    message = response.json()["message"]
    assert "persons[1].phone" in message
    assert "persons[3].cid" in message
    assert "persons[4].phone" in message
    assert "persons[0]" not in message and "persons[2]" not in message
    assert "1909800123456" not in response.text
    assert await _log_statuses() == ["denied_validation_error"]
    assert await _rows() == []


async def test_group_duplicate_via_hold_is_409_with_index(
    client: AsyncClient, shelters: None
) -> None:
    await PublicPerson(
        id="evacuee:held",
        shelter_code="SH001",
        first_name="x",
        last_name_masked="x.",
        national_id_hash=national_id_hash(_cid(1)),
        status="pre_registered",
        updated_at=datetime.now(UTC),
    ).insert()
    response = await client.post(URL, json=_group_payload(3), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_booking"
    assert response.json()["detail"] == "persons[1]"
    assert _cid(1) not in response.text
    assert await _rows() == []
    assert await _log_statuses() == ["denied_duplicate_booking"]


async def test_group_duplicate_via_open_booking_reports_first_index(
    client: AsyncClient, shelters: None
) -> None:
    await _booking(cid=_cid(2), booking_id="BK-OLD")
    await _booking(cid=_cid(1), booking_id="BK-OLD2", row_id="BP-OLD2")
    response = await client.post(URL, json=_group_payload(4), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["detail"] == "persons[1]"
    assert len(await _rows()) == 2  # only the two pre-existing rows


async def test_group_race_loser_leaves_nothing_behind(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A row of another request lands between the pre-check and the insert."""
    from apiapp.modules.thirdparty_bookings import use_case

    real = use_case.ExternalBooking.insert_many

    async def racing(rows: Any, **kwargs: Any) -> Any:
        await _booking(cid=_cid(2), booking_id="BK-WINNER")
        return await real(rows, **kwargs)

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", racing)
    response = await client.post(URL, json=_group_payload(4), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_booking"
    assert response.json()["detail"] == "persons[2]"
    rows = await _rows()
    assert [row["booking_id"] for row in rows] == ["BK-WINNER"]
    assert await _log_statuses() == ["denied_duplicate_booking"]


async def test_race_reports_lowest_colliding_index_not_first_in_insert_order(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two rows collide at insert time; the higher index sorts first by cid_hash.

    The unique-index error names only the first colliding row in insert order (index 3
    here), but the 409 must report the lowest colliding index (1), like the pre-check.
    """
    from apiapp.modules.thirdparty_bookings import use_case

    # Precondition: in cid_hash order index 3 comes before index 1.
    assert national_id_hash(_cid(3)) < national_id_hash(_cid(1))

    real = use_case.ExternalBooking.insert_many

    async def racing(rows: Any, **kwargs: Any) -> Any:
        await _booking(cid=_cid(1), booking_id="BK-WINNER-1")
        await _booking(cid=_cid(3), booking_id="BK-WINNER-3")
        return await real(rows, **kwargs)

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", racing)
    response = await client.post(URL, json=_group_payload(4), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_booking"
    assert response.json()["detail"] == "persons[1]"
    assert _cid(1) not in response.text and _cid(3) not in response.text
    assert sorted(row["booking_id"] for row in await _rows()) == [
        "BK-WINNER-1",
        "BK-WINNER-3",
    ]
    assert await _log_statuses() == ["denied_duplicate_booking"]


async def test_race_falls_back_to_colliding_row_when_recheck_finds_nothing(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from apiapp.modules.thirdparty_bookings import use_case

    real_insert = use_case.ExternalBooking.insert_many
    real_taken = use_case.ThirdPartyBookingsUseCase._taken_cid_hashes
    calls: list[int] = []

    async def racing(rows: Any, **kwargs: Any) -> Any:
        await _booking(cid=_cid(2), booking_id="BK-WINNER")
        return await real_insert(rows, **kwargs)

    async def pre_check_only(self: Any, location_code: str, cid_hashes: list[str]) -> set[str]:
        calls.append(1)
        if len(calls) == 1:
            return await real_taken(self, location_code, cid_hashes)
        return set()  # the re-check after the race sees nothing

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", racing)
    monkeypatch.setattr(use_case.ThirdPartyBookingsUseCase, "_taken_cid_hashes", pre_check_only)
    response = await client.post(URL, json=_group_payload(4), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["detail"] == "persons[2]"
    assert len(calls) == 2
    assert [row["booking_id"] for row in await _rows()] == ["BK-WINNER"]


async def test_staged_insert_failure_leaves_nothing_behind(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from apiapp.modules.thirdparty_bookings import use_case

    async def broken(rows: Any, **kwargs: Any) -> Any:
        await ExternalBooking.get_pymongo_collection().insert_one(rows[0].model_dump(by_alias=True))
        raise RuntimeError("boom")

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", broken)
    with pytest.raises(RuntimeError):
        await client.post(URL, json=_group_payload(3), headers=GRANTED)
    assert await _rows() == []


def _fail_update_many(monkeypatch: pytest.MonkeyPatch, failures: int | None) -> list[int]:
    """Make `update_many` on `external_bookings` raise `failures` times (None = always)."""
    collection = ExternalBooking.get_pymongo_collection()
    real = type(collection).update_many
    calls = [0]

    async def flaky(self: Any, *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name:
            calls[0] += 1
            if failures is None or calls[0] <= failures:
                raise RuntimeError("boom")
        return await real(self, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_many", flaky)
    return calls


async def test_commit_step_is_retried_after_a_transient_failure(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _fail_update_many(monkeypatch, failures=1)
    response = await client.post(URL, json=_group_payload(3), headers=GRANTED)
    assert response.status_code == 201
    assert calls[0] == 2
    rows = await _rows(response.json()["result"]["booking_id"])
    assert len(rows) == 3
    assert all(row["committed"] is True for row in rows)


async def test_commit_step_failure_removes_every_pending_row(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _booking(cid=_cid(9), booking_id="BK-OTHER")  # another group must stay untouched
    calls = _fail_update_many(monkeypatch, failures=None)
    response = await client.post(URL, json=_group_payload(3), headers=GRANTED)
    _assert_sanitized_500(response)
    assert calls[0] == 3
    assert [row["booking_id"] for row in await _rows()] == ["BK-OTHER"]
    await _assert_one_internal_error_log()


def _sweep_before_update_many(
    monkeypatch: pytest.MonkeyPatch, *, delete: dict[str, Any]
) -> list[int]:
    """Simulate the worker sweeper deleting rows just before the commit flip runs."""
    collection = ExternalBooking.get_pymongo_collection()
    real = type(collection).update_many
    calls = [0]

    async def swept(self: Any, *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name:
            calls[0] += 1
            await self.delete_many(delete)
        return await real(self, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_many", swept)
    return calls


@pytest.mark.parametrize("delete", [{"person_seq": 1}, {}], ids=["one-row", "whole-group"])
async def test_commit_shortfall_fails_without_retry_and_removes_pending_rows(
    client: AsyncClient,
    shelters: None,
    monkeypatch: pytest.MonkeyPatch,
    delete: dict[str, Any],
) -> None:
    """Rows swept mid-commit must not be answered with a 201 (CR-169 FR-33)."""
    await _booking(cid=_cid(9), booking_id="BK-OTHER")  # another group must stay untouched
    calls = _sweep_before_update_many(
        monkeypatch, delete={**delete, "committed": False, "booking_id": {"$ne": "BK-OTHER"}}
    )
    response = await client.post(URL, json=_group_payload(3), headers=GRANTED)
    _assert_sanitized_500(response)
    assert calls[0] == 1  # a shortfall is permanent: not retried
    assert [row["booking_id"] for row in await _rows()] == ["BK-OTHER"]
    await _assert_one_internal_error_log()


async def test_commit_shortfall_keeps_rows_the_worker_already_advanced(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from apiapp.modules.thirdparty_bookings import use_case

    real = ExternalBooking.insert_many

    async def advance_one(rows: Any, **kwargs: Any) -> Any:
        result = await real(rows, **kwargs)
        await ExternalBooking.get_pymongo_collection().update_one(
            {"_id": rows[0].id}, {"$set": {"state": "written"}}
        )
        return result

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", advance_one)
    _sweep_before_update_many(monkeypatch, delete={"person_seq": 2})
    response = await client.post(URL, json=_group_payload(3), headers=GRANTED)
    _assert_sanitized_500(response)
    assert [row["state"] for row in await _rows()] == ["written"]


async def test_commit_step_failure_keeps_rows_the_worker_already_advanced(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from apiapp.modules.thirdparty_bookings import use_case

    real = ExternalBooking.insert_many

    async def advance_one(rows: Any, **kwargs: Any) -> Any:
        result = await real(rows, **kwargs)
        await ExternalBooking.get_pymongo_collection().update_one(
            {"_id": rows[0].id}, {"$set": {"state": "written"}}
        )
        return result

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", advance_one)
    _fail_update_many(monkeypatch, failures=None)
    response = await client.post(URL, json=_group_payload(3), headers=GRANTED)
    _assert_sanitized_500(response)
    assert [row["state"] for row in await _rows()] == ["written"]


@pytest.fixture(autouse=True)
def _no_retry_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    from apiapp.modules.thirdparty_bookings import use_case

    monkeypatch.setattr(use_case, "_RETRY_BACKOFF_SECONDS", 0)


def _fail_delete_many(monkeypatch: pytest.MonkeyPatch, failures: int | None) -> list[int]:
    """Make `delete_many` on `external_bookings` raise `failures` times (None = always)."""
    collection = ExternalBooking.get_pymongo_collection()
    real = type(collection).delete_many
    calls = [0]

    async def flaky(self: Any, *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name:
            calls[0] += 1
            if failures is None or calls[0] <= failures:
                raise RuntimeError("boom")
        return await real(self, *args, **kwargs)

    monkeypatch.setattr(type(collection), "delete_many", flaky)
    return calls


async def test_non_duplicate_bulk_write_error_is_sanitized(
    client: AsyncClient,
    shelters: None,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from apiapp.modules.thirdparty_bookings import use_case

    async def broken(rows: Any, **kwargs: Any) -> Any:
        await ExternalBooking.get_pymongo_collection().insert_one(rows[0].model_dump(by_alias=True))
        leaked = {"cid": CID, "phone": "0812345678", "first_name": "สมชาย"}
        raise BulkWriteError(
            {
                "writeErrors": [
                    {
                        "index": 0,
                        "code": 121,
                        "errmsg": f"Document failed validation {leaked}",
                        "op": leaked,
                    }
                ],
                "writeConcernErrors": [],
                "nInserted": 1,
            }
        )

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", broken)
    with caplog.at_level(logging.DEBUG):
        response = await client.post(URL, json=_payload(), headers=GRANTED)
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    # Only the app's own records: pymongo's DEBUG command log would echo the test's own
    # seeding insert, which is not what is under test here.
    app_logs = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("apiapp"))
    for secret in (CID, "0812345678", "081-234-5678", "สมชาย"):
        assert secret not in response.text
        assert secret not in app_logs
    assert "121" in app_logs  # only the error code is logged
    assert await _rows() == []
    await _assert_one_internal_error_log()


async def test_granted_log_failure_after_commit_still_returns_201(
    client: AsyncClient,
    shelters: None,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from apiapp.modules.thirdparty_bookings import use_case

    async def broken(self: Any, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError(f"log store down {CID}")

    monkeypatch.setattr(use_case.ThirdPartyAccessLog, "insert", broken)
    with caplog.at_level(logging.WARNING):
        response = await client.post(URL, json=_group_payload(3), headers=GRANTED)
    assert response.status_code == 201
    rows = await _rows(response.json()["result"]["booking_id"])
    assert len(rows) == 3
    assert all(row["committed"] is True for row in rows)
    assert "RuntimeError" in caplog.text
    assert CID not in caplog.text  # only the exception type is logged


async def test_cleanup_is_retried_after_a_transient_failure(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from apiapp.modules.thirdparty_bookings import use_case

    async def broken(rows: Any, **kwargs: Any) -> Any:
        await ExternalBooking.get_pymongo_collection().insert_one(rows[0].model_dump(by_alias=True))
        raise RuntimeError("boom")

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", broken)
    calls = _fail_delete_many(monkeypatch, failures=1)
    with pytest.raises(RuntimeError, match="boom"):
        await client.post(URL, json=_group_payload(3), headers=GRANTED)
    assert calls[0] == 2
    assert await _rows() == []


async def test_failed_cleanup_does_not_mask_the_duplicate_409(
    client: AsyncClient,
    shelters: None,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    from apiapp.modules.thirdparty_bookings import use_case

    real = use_case.ExternalBooking.insert_many

    async def racing(rows: Any, **kwargs: Any) -> Any:
        await _booking(cid=_cid(2), booking_id="BK-WINNER")
        return await real(rows, **kwargs)

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", racing)
    calls = _fail_delete_many(monkeypatch, failures=None)
    with caplog.at_level(logging.WARNING):
        response = await client.post(URL, json=_group_payload(4), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_booking"
    assert response.json()["detail"] == "persons[2]"
    assert calls[0] == 3
    assert "could not be removed" in caplog.text
    assert await _log_statuses() == ["denied_duplicate_booking"]


@pytest.mark.parametrize("same_order", [True, False])
async def test_concurrent_overlapping_groups_yield_one_winner(
    client: AsyncClient, shelters: None, same_order: bool
) -> None:
    first = _group_payload(4)
    second = _group_payload(4)
    second["persons"] = list(first["persons"][1:3])  # overlaps first on persons 1 and 2
    second["persons"].append(
        {"cid": _cid(9), "first_name": "ก", "last_name": "ข", "phone": "0899999999"}
    )
    if not same_order:
        second["persons"].reverse()
    responses = await asyncio.gather(
        client.post(URL, json=first, headers=GRANTED),
        client.post(URL, json=second, headers=GRANTED),
    )
    assert sorted(r.status_code for r in responses) == [201, 409]
    winner = next(r for r in responses if r.status_code == 201).json()["result"]
    rows = await _rows()
    assert {row["booking_id"] for row in rows} == {winner["booking_id"]}
    assert len(rows) == winner["persons_count"]
    assert {row["committed"] for row in rows} == {True}


async def test_group_rows_are_invisible_until_committed(client: AsyncClient) -> None:
    await _group(2, committed=False)
    assert (await client.get(f"{URL}/BK-GROUP001", headers=GRANTED)).status_code == 404
    assert (await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)).status_code == 404


@pytest.mark.parametrize("how", ["one_still_staged", "one_row_missing"])
async def test_partially_committed_group_is_not_found(client: AsyncClient, how: str) -> None:
    """Mid commit-flip a reader sees only part of the group: it must read as not found."""
    await _group(3)
    collection = ExternalBooking.get_pymongo_collection()
    if how == "one_still_staged":
        await collection.update_one({"_id": "BP-BK-GROUP001-2"}, {"$set": {"committed": False}})
    else:
        await collection.delete_one({"_id": "BP-BK-GROUP001-2"})
    before = await _rows()

    cancel = await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)
    status = await client.get(f"{URL}/BK-GROUP001", headers=GRANTED)
    assert cancel.status_code == 404
    assert cancel.json()["code"] == "booking_not_found"
    assert status.status_code == 404
    assert await _rows() == before  # nothing was cancelled or cleared
    assert await _log_statuses() == ["denied_booking_not_found"] * 2


async def test_legacy_row_without_group_fields_is_a_complete_group(client: AsyncClient) -> None:
    await _booking(booking_id="BK-LEGACY")
    await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": "BK-LEGACY"}, {"$unset": {"committed": "", "group_size": "", "person_seq": ""}}
    )
    status = await client.get(f"{URL}/BK-LEGACY", headers=GRANTED)
    assert status.status_code == 200
    assert status.json()["result"]["booking_status"] == "BOOKED"
    cancel = await client.post(_cancel_url("BK-LEGACY"), headers=GRANTED)
    assert cancel.status_code == 200


async def test_log_failure_during_duplicate_race_leaves_no_pii_in_the_chain(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`BulkWriteError` embeds the rows; nothing raised later may chain back to it."""
    from apiapp.modules.thirdparty_bookings import use_case

    real = use_case.ExternalBooking.insert_many

    async def racing(rows: Any, **kwargs: Any) -> Any:
        await _booking(cid=CID, booking_id="BK-WINNER")
        return await real(rows, **kwargs)

    async def broken(self: Any, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("log store down")

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", racing)
    monkeypatch.setattr(use_case.ThirdPartyAccessLog, "insert", broken)
    with pytest.raises(RuntimeError, match="log store down") as caught:
        await client.post(URL, json=_payload(), headers=GRANTED)
    assert not _chain_has_bulk_write_error(caught.value)
    text = _chain_text(caught.value)
    for secret in _PII:
        assert secret not in text
    assert [row["booking_id"] for row in await _rows()] == ["BK-WINNER"]


async def test_cancelled_request_waits_for_the_insert_before_cleanup(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cleanup must not run before mongod applied an insert whose caller was cancelled."""
    from apiapp.modules.thirdparty_bookings import use_case

    real = use_case.ExternalBooking.insert_many
    started, release = asyncio.Event(), asyncio.Event()
    applied: list[bool] = []

    async def slow(rows: Any, **kwargs: Any) -> Any:
        started.set()
        await release.wait()
        result = await real(rows, **kwargs)
        applied.append(True)
        return result

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", slow)
    request = asyncio.create_task(_create_directly(_group_payload(3)))
    await started.wait()
    request.cancel()
    await asyncio.sleep(0)  # the request is now cancelled while its insert is still in flight
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await request
    await _drain_detached()
    assert applied == [True]  # the insert really landed after the cancellation...
    assert await _rows() == []  # ...and was still cleaned up
    assert await _log_statuses() == []


async def test_cancelled_granted_log_still_returns_the_booking(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from apiapp.modules.thirdparty_bookings import use_case

    real = use_case.ThirdPartyAccessLog.insert
    started, release = asyncio.Event(), asyncio.Event()

    async def slow(self: Any, *args: Any, **kwargs: Any) -> Any:
        started.set()
        await release.wait()
        return await real(self, *args, **kwargs)

    monkeypatch.setattr(use_case.ThirdPartyAccessLog, "insert", slow)
    request = asyncio.create_task(_create_directly(_group_payload(3)))
    await started.wait()
    request.cancel()
    release.set()
    envelope = await request  # the commit already happened, so the result is still returned
    assert envelope.result.persons_count == 3
    await _drain_detached()
    rows = await _rows(envelope.result.booking_id)
    assert len(rows) == 3
    assert all(row["committed"] is True for row in rows)
    assert await _log_statuses() == ["granted"]  # the detached write still completed


async def test_staging_rows_of_another_request_do_not_trip_the_pre_check(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pre-check ignores `committed=False` rows; the unique index still decides at insert."""
    from apiapp.modules.thirdparty_bookings import use_case

    await _booking(cid=_cid(1), booking_id="BK-STAGING", committed=False)
    real = use_case.ExternalBooking.insert_many
    inserts: list[int] = []

    async def spy(rows: Any, **kwargs: Any) -> Any:
        inserts.append(len(rows))
        return await real(rows, **kwargs)

    monkeypatch.setattr(use_case.ExternalBooking, "insert_many", spy)
    response = await client.post(URL, json=_group_payload(3), headers=GRANTED)
    # Reaching the insert proves the pre-check did not fire. The index then still refuses
    # the CID that the other request holds (409), and our own rows are rolled back.
    assert inserts == [3]
    assert response.status_code == 409
    assert response.json()["detail"] == "persons[1]"
    assert [row["booking_id"] for row in await _rows()] == ["BK-STAGING"]


async def test_rolled_back_group_does_not_block_a_later_booking(
    client: AsyncClient, shelters: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fail_update_many(monkeypatch, failures=3)  # every attempt of the first request fails
    _assert_sanitized_500(await client.post(URL, json=_group_payload(3), headers=GRANTED))
    assert await _rows() == []
    response = await client.post(URL, json=_group_payload(3), headers=GRANTED)
    assert response.status_code == 201
    assert len(await _rows(response.json()["result"]["booking_id"])) == 3


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
    assert await _log_statuses() == ["granted"]


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
    assert await _log_statuses() == ["granted"]


async def test_cancel_written_without_projection_requests_cancel(client: AsyncClient) -> None:
    await _booking(state="written", evacuee_id="evacuee:01JNOTYET")
    response = await client.post(_cancel_url(), headers=GRANTED)
    assert response.status_code == 200
    booking = await ExternalBooking.get("BK-TEST0001")
    assert booking is not None and booking.cancel_requested is True
    assert await _log_statuses() == ["granted"]


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
    assert await _log_statuses() == ["denied_booking_not_found"]


async def test_cancel_twice_is_idempotent(client: AsyncClient) -> None:
    await _booking(state="pending")
    first = await client.post(_cancel_url(), json={"reason": "first"}, headers=GRANTED)
    assert first.status_code == 200
    before = await _rows("BK-TEST0001")
    second = await client.post(_cancel_url(), json={"reason": "second"}, headers=GRANTED)
    assert second.status_code == 200
    assert second.json()["result"] == {"booking_id": "BK-TEST0001", "booking_status": "CANCELLED"}
    assert await _rows("BK-TEST0001") == before
    assert await _log_statuses() == ["granted", "granted"]


@pytest.mark.parametrize(
    ("state", "cancel_requested", "status_code"),
    [("cancelled", False, 200), ("written", True, 200), ("rejected", False, 409)],
)
async def test_cancel_finished_single_is_idempotent_or_409(
    client: AsyncClient, state: str, cancel_requested: bool, status_code: int
) -> None:
    """FR-40 legacy single-person booking: `cancelled` repeats as 200, `rejected` stays 409."""
    await _booking(state=state, cancel_requested=cancel_requested)
    before = await _rows("BK-TEST0001")
    response = await client.post(_cancel_url(), headers=GRANTED)
    assert response.status_code == status_code
    if status_code == 200:
        assert response.json()["result"] == {
            "booking_id": "BK-TEST0001",
            "booking_status": "CANCELLED",
        }
        assert await _log_statuses() == ["granted"]
    else:
        assert response.json()["code"] == "booking_not_cancellable"
        assert await _log_statuses() == ["denied_booking_not_cancellable"]
    assert await _rows("BK-TEST0001") == before


async def test_cancel_group_pending_and_written(client: AsyncClient) -> None:
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["pending", "written", "pending"])
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    assert response.json()["result"] == {
        "booking_id": "BK-GROUP001",
        "booking_status": "CANCELLED",
    }
    rows = await _rows("BK-GROUP001")
    assert [(row["state"], row["cancel_requested"]) for row in rows] == [
        ("cancelled", False),
        ("written", True),
        ("cancelled", False),
    ]
    assert all(row["cancel_reason"] == "r" for row in rows)
    for index in (0, 2):
        assert (rows[index]["cid"], rows[index]["phone"]) == (None, None)
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [(log.endpoint, log.status) for log in logs] == [("EXT-009", "granted")]


async def test_cancel_group_blocked_member_changes_nothing(client: AsyncClient) -> None:
    await _person(status="active", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["pending", "written", "pending"])
    before = await _rows("BK-GROUP001")
    response = await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    assert await _rows("BK-GROUP001") == before
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_by_other_client_is_404(client: AsyncClient) -> None:
    await _group(2)
    before = await _rows("BK-GROUP001")
    response = await client.post(_cancel_url("BK-GROUP001"), headers=OTHER_CLIENT)
    assert response.status_code == 404
    assert response.json()["code"] == "booking_not_found"
    assert await _rows("BK-GROUP001") == before
    assert await _log_statuses() == ["denied_booking_not_found"]


async def test_cancel_group_twice_is_idempotent(client: AsyncClient) -> None:
    await _group(2)
    assert (await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)).status_code == 200
    before = await _rows("BK-GROUP001")
    second = await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)
    assert second.status_code == 200
    assert second.json()["result"] == {"booking_id": "BK-GROUP001", "booking_status": "CANCELLED"}
    assert await _rows("BK-GROUP001") == before
    assert await _log_statuses() == ["granted", "granted"]


async def test_cancel_group_skips_finished_rows(client: AsyncClient) -> None:
    """FR-40: finished rows are not touched and keep their earlier cancel_reason."""
    await _group(3, ["cancelled", "pending", "written"])
    await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": "BP-BK-GROUP001-0"}, {"$set": {"cancel_reason": "earlier"}}
    )
    await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": "BP-BK-GROUP001-2"},
        {"$set": {"cancel_requested": True, "cancel_reason": "earlier"}},
    )
    before = await _rows("BK-GROUP001")
    response = await client.post(
        _cancel_url("BK-GROUP001"), json={"reason": "new"}, headers=GRANTED
    )
    assert response.status_code == 200
    assert response.json()["result"]["booking_status"] == "CANCELLED"
    rows = await _rows("BK-GROUP001")
    assert rows[0] == before[0]
    assert rows[2] == before[2]
    assert rows[0]["cancel_reason"] == "earlier"
    assert rows[2]["cancel_reason"] == "earlier"
    assert (rows[1]["state"], rows[1]["cancel_reason"]) == ("cancelled", "new")
    assert (rows[1]["cid"], rows[1]["phone"]) == (None, None)
    assert await _log_statuses() == ["granted"]


async def test_cancel_group_with_rejected_member_cancels_open_rows(client: AsyncClient) -> None:
    await _group(3, ["rejected", "pending", "pending"])
    await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": "BP-BK-GROUP001-0"}, {"$set": {"reject_reason": "duplicate"}}
    )
    before = await _rows("BK-GROUP001")
    response = await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)
    assert response.status_code == 200
    rows = await _rows("BK-GROUP001")
    assert rows[0] == before[0]
    assert [(row["state"], row["cancel_requested"]) for row in rows] == [
        ("rejected", False),
        ("cancelled", False),
        ("cancelled", False),
    ]
    assert await _log_statuses() == ["granted"]


async def test_cancel_group_all_rejected_is_409(client: AsyncClient) -> None:
    await _group(2, ["rejected", "rejected"])
    before = await _rows("BK-GROUP001")
    response = await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    assert await _rows("BK-GROUP001") == before
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_checked_in_member_with_rejected_changes_nothing(
    client: AsyncClient,
) -> None:
    await _person(status="active", person_id="evacuee:BK-GROUP001-2")
    await _group(3, ["rejected", "pending", "written"])
    before = await _rows("BK-GROUP001")
    response = await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    assert await _rows("BK-GROUP001") == before
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


def _snapshot(rows: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    """The cancel-relevant columns of each row (`updated_at` is left out: every write moves it)."""
    return [
        (row["state"], row["cancel_requested"], row.get("cancel_reason"), row.get("cid"))
        for row in rows
    ]


async def _set_row(row_id: str, fields: dict[str, Any]) -> None:
    await ExternalBooking.get_pymongo_collection().update_one({"_id": row_id}, {"$set": fields})


async def _set_stay(person_id: str, status: str) -> None:
    await PublicPerson.get_pymongo_collection().update_one(
        {"_id": person_id}, {"$set": {"status": status}}
    )


def _spy_bulk_writes(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, Any]]]:
    """Record every `update_one` / `update_many` on external_bookings, in call order."""
    collection = ExternalBooking.get_pymongo_collection()
    calls: list[tuple[str, dict[str, Any]]] = []
    real_one = type(collection).update_one
    real_many = type(collection).update_many

    async def one(self: Any, flt: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name:
            calls.append(("update_one", flt))
        return await real_one(self, flt, *args, **kwargs)

    async def many(self: Any, flt: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name:
            calls.append(("update_many", flt))
        return await real_many(self, flt, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_one", one)
    monkeypatch.setattr(type(collection), "update_many", many)
    return calls


def _bulk_state_writes(
    calls: list[tuple[str, dict[str, Any]]],
) -> list[tuple[str, dict[str, Any]]]:
    """The state-changing writes only: the token clear (CR-169 FR-40) filters on token."""
    return [(name, flt) for name, flt in calls if "state" in flt]


def _around_update_many(
    monkeypatch: pytest.MonkeyPatch,
    *,
    when: Callable[[dict[str, Any]], bool],
    before: Callable[[], Awaitable[None]] | None = None,
    after: Callable[[], Awaitable[None]] | None = None,
) -> None:
    """Run `before` / `after` around the first matching `update_many` on external_bookings."""
    collection = ExternalBooking.get_pymongo_collection()
    real = type(collection).update_many
    done = [False]

    async def hooked(self: Any, flt: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name and not done[0] and when(flt):
            done[0] = True
            if before is not None:
                await before()
            result = await real(self, flt, *args, **kwargs)
            if after is not None:
                await after()
            return result
        return await real(self, flt, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_many", hooked)


def _fail_update_many_when(
    monkeypatch: pytest.MonkeyPatch, *, when: Callable[[dict[str, Any]], bool], failures: int
) -> None:
    """Make the first `failures` matching `update_many` calls raise before touching the DB."""
    collection = ExternalBooking.get_pymongo_collection()
    real = type(collection).update_many
    calls = [0]

    async def flaky(self: Any, flt: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name and when(flt):
            calls[0] += 1
            if calls[0] <= failures:
                raise RuntimeError("boom")
        return await real(self, flt, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_many", flaky)


def _miss_pending_updates(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make every guarded write of a pending row report zero modified documents."""
    collection = ExternalBooking.get_pymongo_collection()
    real_one = type(collection).update_one
    real_many = type(collection).update_many

    async def one(self: Any, flt: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name and flt.get("state") == "pending":
            return SimpleNamespace(modified_count=0)
        return await real_one(self, flt, *args, **kwargs)

    async def many(self: Any, flt: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name and flt.get("state") == "pending":
            return SimpleNamespace(modified_count=0)
        return await real_many(self, flt, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_one", one)
    monkeypatch.setattr(type(collection), "update_many", many)


async def test_cancel_group_flags_written_rows_before_cancelling_pending(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["pending", "written", "pending"])
    calls = _spy_bulk_writes(monkeypatch)
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    assert [(name, flt["state"]) for name, flt in _bulk_state_writes(calls)] == [
        ("update_many", "written"),
        ("update_many", "pending"),
    ]
    assert calls[0][1]["cancel_requested"] is False
    assert await _log_statuses() == ["granted"]


async def test_cancel_group_common_path_uses_two_bulk_writes(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No per-row write on the common path: the write count does not grow with the group."""
    states = ["written" if i % 2 else "pending" for i in range(20)]
    for i, state in enumerate(states):
        if state == "written":
            await _person(status="pre_registered", person_id=f"evacuee:BK-GROUP001-{i}")
    await _group(20, states)
    calls = _spy_bulk_writes(monkeypatch)
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    assert [name for name, _ in _bulk_state_writes(calls)] == ["update_many", "update_many"]
    rows = await _rows("BK-GROUP001")
    assert len(rows) == 20
    assert [(row["state"], row["cancel_requested"]) for row in rows] == [
        ("written", True) if i % 2 else ("cancelled", False) for i in range(20)
    ]
    assert all(row["cancel_reason"] == "r" for row in rows)
    for row in rows[::2]:
        assert (row["cid"], row["phone"]) == (None, None)
    assert await _log_statuses() == ["granted"]


async def test_cancel_group_check_in_after_flagging_reverts_our_flags(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A check-in between the flag write and the stay re-read: 409, flags reverted."""
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["pending", "written", "pending"])
    before = await _rows("BK-GROUP001")
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("cancel_requested") is False,
        after=lambda: _set_stay("evacuee:BK-GROUP001-1", "active"),
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    after = await _rows("BK-GROUP001")
    assert _snapshot(after) == _snapshot(before)
    assert after[1]["cancel_requested"] is False
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_conflict_with_failing_revert_keeps_409(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """2a 409 path: the revert of our flags fails. The 409 still wins, the failure is logged.

    A check-in lands after the flag write, so the stay re-read reports not cancellable and the
    revert runs. The revert raises: the response stays `booking_not_cancellable` (not a 500),
    and the log line carries only the booking id and the error type, never PII.
    """
    from apiapp.modules.thirdparty_bookings import use_case

    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["pending", "written", "pending"])
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("cancel_requested") is False,
        after=lambda: _set_stay("evacuee:BK-GROUP001-1", "active"),
    )

    async def failing_revert(
        self: Any, collection: Any, ids: list[str], now: Any, token: Any
    ) -> None:
        raise RuntimeError("revert boom")

    monkeypatch.setattr(use_case.ThirdPartyBookingsUseCase, "_revert_flags", failing_revert)
    with caplog.at_level(logging.ERROR):
        response = await client.post(
            _cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED
        )
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    messages = [r.getMessage() for r in caplog.records if "flag revert failed" in r.getMessage()]
    assert messages == ["cancel flag revert failed (booking_id=BK-GROUP001 error=RuntimeError)"]
    for secret in (CID, "สมชาย"):
        assert secret not in "\n".join(messages)
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_foreign_flag_set_mid_request_is_left_alone(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Another request flags an open row between phase 1 and step 2a; our 409 must not touch it.

    Row 0 is OPEN at phase 1 and planned as a request. Before our flag write, a foreign request
    flags it (its own marker). Our flag write then misses row 0, row 0 is FINISHED for us and
    skipped, and the check-in on row 1 reverts only the flag this request set.
    """
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-0")
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["written", "written", "pending"])
    foreign_at = datetime(2026, 9, 1)
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("cancel_requested") is False,
        before=lambda: _set_row(
            "BP-BK-GROUP001-0",
            {
                "cancel_requested": True,
                "cancel_reason": "foreign",
                "cancel_flag_token": "other-request",
                "updated_at": foreign_at,
            },
        ),
        after=lambda: _set_stay("evacuee:BK-GROUP001-1", "active"),
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    after = await _rows("BK-GROUP001")
    assert (after[0]["cancel_requested"], after[0]["cancel_reason"]) == (True, "foreign")
    assert after[0]["updated_at"] == foreign_at
    assert (after[1]["state"], after[1]["cancel_requested"], after[1]["cancel_reason"]) == (
        "written",
        False,
        None,
    )
    assert (after[2]["state"], after[2]["cid"]) == ("pending", _cid(2))
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_foreign_flag_on_written_row_is_409_not_200(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A concurrent request flags a written row we planned as OPEN: never a 200 without it.

    Row 0 is OPEN at phase 1. A foreign request flags it just before our flag write, so our
    write flags only row 1. The old code treated row 0 as FINISHED, kept row 1 (stay ok) and
    cancelled the pending row 2 with a 200 while row 0 stayed open. Now the step is a 409: our
    flag on row 1 is reverted, the foreign flag on row 0 and the pending row 2 are untouched.
    """
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-0")
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["written", "written", "pending"])
    foreign_at = datetime(2026, 9, 1)
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("cancel_requested") is False,
        before=lambda: _set_row(
            "BP-BK-GROUP001-0",
            {
                "cancel_requested": True,
                "cancel_reason": "foreign",
                "cancel_flag_token": "other-request",
                "updated_at": foreign_at,
            },
        ),
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    after = await _rows("BK-GROUP001")
    assert (after[0]["cancel_requested"], after[0]["cancel_reason"]) == (True, "foreign")
    assert (after[0]["cancel_flag_token"], after[0]["updated_at"]) == ("other-request", foreign_at)
    assert (after[1]["state"], after[1]["cancel_requested"], after[1]["cancel_reason"]) == (
        "written",
        False,
        None,
    )
    assert (after[2]["state"], after[2]["cid"]) == ("pending", _cid(2))
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_pending_row_flagged_elsewhere_mid_way_is_409(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 2b: a pending row that becomes a foreign-flagged written row is a conflict.

    The bulk pending cancel misses row 1, which a concurrent request has just moved to written
    and flagged. It is in flight (not FINISHED), so the request is a 409 rather than a skip.
    Row 0 was cancelled by the bulk step before the conflict: that is the documented 2b residual
    race, and the foreign flag on row 1 is left alone.
    """
    await _group(2, ["pending", "pending"])
    foreign_at = datetime(2026, 9, 1)
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("state") == "pending",
        before=lambda: _set_row(
            "BP-BK-GROUP001-1",
            {
                "state": "written",
                "cancel_requested": True,
                "cancel_reason": "foreign",
                "cancel_flag_token": "other-request",
                "updated_at": foreign_at,
            },
        ),
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    rows = await _rows("BK-GROUP001")
    assert [(row["state"], row["cancel_requested"]) for row in rows] == [
        ("cancelled", False),
        ("written", True),
    ]
    assert (rows[1]["cancel_reason"], rows[1]["updated_at"]) == ("foreign", foreign_at)
    assert rows[1]["cid"] == _cid(1)
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_pending_conflict_reverts_our_written_flags(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 2b conflict after phase 2a flagged a written row: 409, and our 2a flag is reverted.

    Row 0 is written with no stay yet (cancellable), so phase 2a flags it. Row 2 is pending and a
    concurrent request flags it while the bulk pending cancel runs, so 2b is a conflict. Row 0
    must not stay `cancel_requested=True` with the worker still cancelling it (CR-169 FR-40,
    decision sync 2026-10-17: all-or-nothing, our flags are reverted). Row 1 was cancelled by the
    bulk step before the conflict and cannot be restored; the foreign flag on row 2 is left alone.
    """
    await _group(3, ["written", "pending", "pending"])
    foreign_at = datetime(2026, 9, 1)
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("state") == "pending",
        before=lambda: _set_row(
            "BP-BK-GROUP001-2",
            {
                "state": "written",
                "cancel_requested": True,
                "cancel_reason": "foreign",
                "cancel_flag_token": "other-request",
                "updated_at": foreign_at,
            },
        ),
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    rows = await _rows("BK-GROUP001")
    assert (rows[0]["state"], rows[0]["cancel_requested"]) == ("written", False)
    assert (rows[0]["cancel_reason"], rows[0]["cancel_flag_token"]) == (None, None)
    assert (rows[1]["state"], rows[1]["cancel_requested"]) == ("cancelled", False)
    assert (rows[2]["state"], rows[2]["cancel_requested"]) == ("written", True)
    assert (rows[2]["cancel_reason"], rows[2]["updated_at"]) == ("foreign", foreign_at)
    assert rows[2]["cancel_flag_token"] == "other-request"
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_revert_keeps_a_flag_set_after_our_marker(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The revert only clears flags that still carry this request's marker.

    Row 0 is flagged by us, a check-in forces the revert, and another writer replaces our flag
    with its own (different `updated_at`) just before the revert runs. The revert must keep it.
    """
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-0")
    await _group(2, ["written", "pending"])
    foreign_at = datetime(2026, 9, 1)
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("cancel_requested") is False,
        after=lambda: _set_stay("evacuee:BK-GROUP001-0", "active"),
    )
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("cancel_requested") is True,
        before=lambda: _set_row(
            "BP-BK-GROUP001-0",
            {
                "cancel_requested": True,
                "cancel_reason": "foreign",
                "cancel_flag_token": "other-request",
                "updated_at": foreign_at,
            },
        ),
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 409
    after = await _rows("BK-GROUP001")
    assert (after[0]["cancel_requested"], after[0]["cancel_reason"]) == (True, "foreign")
    assert after[0]["updated_at"] == foreign_at
    assert (after[1]["state"], after[1]["cid"]) == ("pending", _cid(1))
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_pending_row_written_mid_way_is_flagged(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 2 re-evaluation: a pending row that became a written, cancellable stay is flagged."""
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(2, ["pending", "pending"])
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("state") == "pending",
        before=lambda: _set_row("BP-BK-GROUP001-1", {"state": "written"}),
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    rows = await _rows("BK-GROUP001")
    assert [(row["state"], row["cancel_requested"], row["cancel_reason"]) for row in rows] == [
        ("cancelled", False, "r"),
        ("written", True, "r"),
    ]
    assert await _log_statuses() == ["granted"]


async def test_cancel_group_row_finished_mid_way_is_skipped(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 2: a row the worker rejects just before the cancel reaches it counts as done."""
    await _group(2, ["pending", "pending"])
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("state") == "pending",
        before=lambda: _set_row(
            "BP-BK-GROUP001-1", {"state": "rejected", "reject_reason": "duplicate"}
        ),
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    rows = await _rows("BK-GROUP001")
    assert [(row["state"], row["cancel_reason"]) for row in rows] == [
        ("cancelled", "r"),
        ("rejected", None),
    ]
    assert await _log_statuses() == ["granted"]


async def test_cancel_group_row_checked_in_mid_way_is_409(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 2: a row that becomes a checked-in stay after phase 1 is a conflict, not a skip.

    Residual race: the pending rows cancelled before the conflict stay cancelled, so the 409
    arrives with a partial cancel. A retry skips those rows (FINISHED).
    """
    await _person(status="active", person_id="evacuee:BK-GROUP001-1")
    await _group(2, ["pending", "pending"])
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("state") == "pending",
        before=lambda: _set_row("BP-BK-GROUP001-1", {"state": "written"}),
    )
    response = await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    rows = await _rows("BK-GROUP001")
    assert [(row["state"], row["cancel_requested"]) for row in rows] == [
        ("cancelled", False),
        ("written", False),
    ]
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


def _skip_row_in_first_pending_bulk(monkeypatch: pytest.MonkeyPatch, row_id: str) -> None:
    """The first pending `update_many` leaves `row_id` out, so that row misses the bulk cancel."""
    collection = ExternalBooking.get_pymongo_collection()
    real_many = type(collection).update_many
    done = [False]

    async def many(self: Any, flt: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name and not done[0] and flt.get("state") == "pending":
            done[0] = True
            ids = [doc_id for doc_id in flt["_id"]["$in"] if doc_id != row_id]
            flt = {**flt, "_id": {"$in": ids}}
        return await real_many(self, flt, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_many", many)


def _miss_first_guarded_pending_writes(
    monkeypatch: pytest.MonkeyPatch,
    row_id: str,
    *,
    before: Callable[[], Awaitable[None]] | None = None,
) -> None:
    """The first guarded `update_one` on `row_id` reports zero modified documents, untouched.

    `before` runs first, to simulate the row moving on in the meantime.
    """
    collection = ExternalBooking.get_pymongo_collection()
    real_one = type(collection).update_one
    seen = [0]

    async def one(self: Any, flt: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
        if (
            self.name == collection.name
            and flt.get("_id") == row_id
            and flt.get("state") == ("pending")
        ):
            seen[0] += 1
            if seen[0] == 1:
                if before is not None:
                    await before()
                return SimpleNamespace(modified_count=0)
        return await real_one(self, flt, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_one", one)


async def test_cancel_group_open_row_missed_once_is_retried_and_cancelled(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Phase 2 re-evaluation: an OPEN, cancellable row that misses one guarded write is retried.

    The bulk pending cancel misses row 1, and its first guarded write misses too while the row
    stays `pending`. The second attempt in `_cancel_row` succeeds, so the request is a 200.
    """
    await _group(2, ["pending", "pending"])
    _skip_row_in_first_pending_bulk(monkeypatch, "BP-BK-GROUP001-1")
    _miss_first_guarded_pending_writes(monkeypatch, "BP-BK-GROUP001-1")
    with caplog.at_level(logging.WARNING):
        response = await client.post(
            _cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED
        )
    assert response.status_code == 200
    assert response.json()["result"] == {"booking_id": "BK-GROUP001", "booking_status": "CANCELLED"}
    rows = await _rows("BK-GROUP001")
    assert [(row["state"], row["cancel_requested"], row["cancel_reason"]) for row in rows] == [
        ("cancelled", False, "r"),
        ("cancelled", False, "r"),
    ]
    assert (rows[1]["cid"], rows[1]["phone"]) == (None, None)
    assert [r for r in caplog.records if "gave up" in r.getMessage()] == []
    assert await _log_statuses() == ["granted"]


async def test_cancel_row_checked_in_during_retry_logs_one_attempt_and_409s(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A retry that finds the row no longer cancellable gives up after the attempt it made."""
    await _person(status="active", person_id="evacuee:BK-GROUP001-1")
    await _group(2, ["pending", "pending"])
    _skip_row_in_first_pending_bulk(monkeypatch, "BP-BK-GROUP001-1")
    _miss_first_guarded_pending_writes(
        monkeypatch,
        "BP-BK-GROUP001-1",
        before=lambda: _set_row("BP-BK-GROUP001-1", {"state": "written"}),
    )
    with caplog.at_level(logging.WARNING):
        response = await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    assert [r.getMessage() for r in caplog.records if "gave up" in r.getMessage()] == [
        "cancel re-evaluation gave up (booking_id=BK-GROUP001 attempts=1)"
    ]
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_row_gives_up_after_bounded_attempts_and_logs(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    await _group(2, ["pending", "pending"])
    _miss_pending_updates(monkeypatch)
    before = await _rows("BK-GROUP001")
    with caplog.at_level(logging.WARNING):
        response = await client.post(_cancel_url("BK-GROUP001"), headers=GRANTED)
    assert response.status_code == 409
    assert [r.getMessage() for r in caplog.records if "gave up" in r.getMessage()] == [
        "cancel re-evaluation gave up (booking_id=BK-GROUP001 attempts=3)"
    ]
    assert await _rows("BK-GROUP001") == before
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_retry_after_failed_bulk_step_succeeds(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _group(2, ["pending", "pending"])
    _fail_update_many_when(monkeypatch, when=lambda flt: flt.get("state") == "pending", failures=1)
    with pytest.raises(RuntimeError):
        await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    monkeypatch.undo()
    assert [row["state"] for row in await _rows("BK-GROUP001")] == ["pending", "pending"]

    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    rows = await _rows("BK-GROUP001")
    assert [row["state"] for row in rows] == ["cancelled", "cancelled"]
    assert all(row["cancel_reason"] == "r" for row in rows)
    assert await _log_statuses() == ["granted"]


def _fail_person_find_after(
    monkeypatch: pytest.MonkeyPatch, *, ok_calls: int, message: str
) -> None:
    """Let the first `ok_calls` `PublicPerson.find` calls through, then raise `message`."""
    real = PublicPerson.find
    seen = [0]

    def find(*args: Any, **kwargs: Any) -> Any:
        seen[0] += 1
        if seen[0] > ok_calls:
            raise RuntimeError(message)
        return real(*args, **kwargs)

    monkeypatch.setattr(PublicPerson, "find", find)


async def test_cancel_group_stay_reread_error_reverts_our_flags(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 2a stay re-read raises after 2a flagged row 1: flag reverted, error propagates.

    `PublicPerson.find` is called once in phase 1 and once for the stay re-read in 2a.
    """
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["pending", "written", "pending"])
    before = await _rows("BK-GROUP001")
    _fail_person_find_after(monkeypatch, ok_calls=1, message="boom")
    with pytest.raises(RuntimeError, match="^boom$"):
        await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    monkeypatch.undo()
    after = await _rows("BK-GROUP001")
    assert _snapshot(after) == _snapshot(before)
    assert (after[1]["cancel_requested"], after[1]["cancel_reason"]) == (False, None)
    assert [(row["state"], row["cid"]) for row in (after[0], after[2])] == [
        ("pending", _cid(0)),
        ("pending", _cid(2)),
    ]
    assert await _log_statuses() == []


async def test_cancel_group_pending_reread_error_reverts_our_flags(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 2b re-read raises after 2a flagged row 1 and the pending update missed.

    A missed pending update sends the request to the per-row re-read in `_cancel_pending`
    (`ExternalBooking.get`). That re-read raises: the flag set in 2a is reverted, the pending
    rows are left untouched, and the error propagates.
    """
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["pending", "written", "pending"])
    before = await _rows("BK-GROUP001")
    _miss_pending_updates(monkeypatch)

    async def failing_get(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("reread boom")

    monkeypatch.setattr(ExternalBooking, "get", failing_get)
    with pytest.raises(RuntimeError, match="^reread boom$"):
        await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    monkeypatch.undo()
    after = await _rows("BK-GROUP001")
    assert _snapshot(after) == _snapshot(before)
    assert (after[1]["cancel_requested"], after[1]["cancel_reason"]) == (False, None)
    assert [(row["state"], row["cid"]) for row in (after[0], after[2])] == [
        ("pending", _cid(0)),
        ("pending", _cid(2)),
    ]
    assert await _log_statuses() == []


async def test_cancel_group_pending_reflag_then_error_reverts_reflagged_rows(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 2b re-flags row 1 in `_cancel_pending`, then a later re-read raises.

    Both rows are pending in phase 1, so 2a has nothing to flag. The pending bulk update misses
    and row 1 has become a written, cancellable stay (`pre_registered`). `_cancel_pending`
    flags it with this request's marker, then the re-read of row 2 raises. The flag set in 2b
    is reverted too, so row 1 is left written and unflagged and row 2 stays pending.
    """
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-0")
    await _group(2, ["pending", "pending"])
    collection = ExternalBooking.get_pymongo_collection()
    real_many = type(collection).update_many

    async def many(self: Any, flt: dict[str, Any], *args: Any, **kwargs: Any) -> Any:
        if self.name == collection.name and flt.get("state") == "pending":
            # Row 1 moves on to written meanwhile; the guarded pending update misses.
            await _set_row("BP-BK-GROUP001-0", {"state": "written"})
            return SimpleNamespace(modified_count=0)
        return await real_many(self, flt, *args, **kwargs)

    monkeypatch.setattr(type(collection), "update_many", many)
    real_get = ExternalBooking.get

    async def get(doc_id: str, *args: Any, **kwargs: Any) -> Any:
        if doc_id == "BP-BK-GROUP001-1":
            raise RuntimeError("reread boom")
        return await real_get(doc_id, *args, **kwargs)

    monkeypatch.setattr(ExternalBooking, "get", get)
    with pytest.raises(RuntimeError, match="^reread boom$"):
        await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    monkeypatch.undo()
    after = await _rows("BK-GROUP001")
    assert [(row["state"], row["cancel_requested"], row["cancel_reason"]) for row in after] == [
        ("written", False, None),
        ("pending", False, None),
    ]
    assert await _log_statuses() == []


async def test_cancel_group_stay_reread_error_keeps_original_error_when_revert_fails(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A failing revert is logged without PII and does not replace the original error."""
    from apiapp.modules.thirdparty_bookings import use_case

    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["pending", "written", "pending"])
    _fail_person_find_after(monkeypatch, ok_calls=1, message="find boom")

    async def failing_revert(
        self: Any, collection: Any, ids: list[str], now: Any, token: Any
    ) -> None:
        raise RuntimeError("revert boom")

    monkeypatch.setattr(use_case.ThirdPartyBookingsUseCase, "_revert_flags", failing_revert)
    with caplog.at_level(logging.ERROR), pytest.raises(RuntimeError, match="^find boom$"):
        await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    messages = [r.getMessage() for r in caplog.records if "flag revert failed" in r.getMessage()]
    assert messages == ["cancel flag revert failed (booking_id=BK-GROUP001 error=RuntimeError)"]
    for secret in (CID, "สมชาย"):
        assert secret not in "\n".join(messages)
    assert await _log_statuses() == []


async def test_cancel_group_pending_write_error_reverts_our_flags(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 2b bulk pending cancel raises after 2a flagged row 1: the flag is reverted."""
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(3, ["pending", "written", "pending"])
    before = await _rows("BK-GROUP001")
    _fail_update_many_when(monkeypatch, when=lambda flt: flt.get("state") == "pending", failures=1)
    with pytest.raises(RuntimeError):
        await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    monkeypatch.undo()
    after = await _rows("BK-GROUP001")
    assert _snapshot(after) == _snapshot(before)
    assert after[1]["cancel_requested"] is False
    assert [row["state"] for row in after] == ["pending", "written", "pending"]
    assert await _log_statuses() == []


async def test_cancel_group_access_log_error_reverts_our_flags(
    app: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Phase 2c: the granted access-log write fails after 2a flagged the written rows.

    Both rows are written, so 2b has nothing to cancel and 2c is the only step after the
    flags. The flags are reverted and the error surfaces as the sanitized partner 500. The
    transport is asked not to re-raise so the response itself can be checked.
    """
    from apiapp.modules.thirdparty_bookings import use_case

    for i in range(2):
        await _person(status="pre_registered", person_id=f"evacuee:BK-GROUP001-{i}")
    await _group(2, ["written", "written"])
    before = await _rows("BK-GROUP001")

    async def broken(self: Any, *args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("log store down")

    monkeypatch.setattr(use_case.ThirdPartyAccessLog, "insert", broken)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as raw:
        response = await raw.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    monkeypatch.undo()
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert "log store down" not in response.text
    after = await _rows("BK-GROUP001")
    assert _snapshot(after) == _snapshot(before)
    assert [(row["cancel_requested"], row["cancel_reason"]) for row in after] == [
        (False, None),
        (False, None),
    ]
    assert await _log_statuses() == []


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
        "persons": [{"index": 0, "booking_status": expected, "reject_reason": reject_reason}],
        "created_at": "2026-08-20T14:30:00+07:00",
        "updated_at": "2026-08-20T14:30:00+07:00",
    }
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [(log.endpoint, log.status) for log in logs] == [("EXT-010", "granted")]


@pytest.mark.parametrize(
    ("states", "expected"),
    [
        (["pending", "written", "pending"], "BOOKED"),
        (["cancelled", "cancelled"], "CANCELLED"),
        (["cancelled", "pending"], "BOOKED"),
        (["written", "rejected", "rejected"], "REJECTED"),
        (["cancelled", "rejected"], "CANCELLED"),
        (["rejected", "rejected"], "REJECTED"),
        (["rejected", "pending"], "REJECTED"),
        (["rejected", "written"], "REJECTED"),
    ],
)
async def test_group_status_aggregate(
    client: AsyncClient, states: list[str], expected: str
) -> None:
    rows = await _group(len(states), states)
    for row, state in zip(rows, states, strict=True):
        if state == "rejected":
            await ExternalBooking.get_pymongo_collection().update_one(
                {"_id": row.id}, {"$set": {"reject_reason": f"duplicate-{row.person_seq}"}}
            )
    response = await client.get(f"{URL}/BK-GROUP001", headers=GRANTED)
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["booking_id"] == "BK-GROUP001"
    assert result["booking_status"] == expected
    assert [p["index"] for p in result["persons"]] == list(range(len(states)))
    first_rejected = next((i for i, s in enumerate(states) if s == "rejected"), None)
    assert result["reject_reason"] == (
        None if first_rejected is None else f"duplicate-{first_rejected}"
    )
    for person in result["persons"]:
        assert set(person) == {"index", "booking_status", "reject_reason"}
    assert str(_cid(0)) not in response.text
    logs = await ThirdPartyAccessLog.find_all().to_list()
    assert [(log.endpoint, log.status) for log in logs] == [("EXT-010", "granted")]


async def test_group_status_cancel_requested_with_rejected_is_cancelled(
    client: AsyncClient,
) -> None:
    """FR-42: a `cancel_requested` row counts as CANCELLED, so no open row → CANCELLED."""
    await _group(2, ["rejected", "written"])
    await ExternalBooking.get_pymongo_collection().update_one(
        {"_id": "BP-BK-GROUP001-1"}, {"$set": {"cancel_requested": True}}
    )
    response = await client.get(f"{URL}/BK-GROUP001", headers=GRANTED)
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["booking_status"] == "CANCELLED"
    assert [p["booking_status"] for p in result["persons"]] == ["REJECTED", "CANCELLED"]


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


async def test_group_lookup_index_exists(client: AsyncClient) -> None:
    indexes = await ExternalBooking.get_pymongo_collection().index_information()
    assert any(info["key"] == [("booking_id", 1), ("person_seq", 1)] for info in indexes.values())


# --- CR-169 FR-40 (decision sync 2026-10-17, #612): cancel_flag_token -----------------------------


async def test_cancel_group_foreign_token_cleared_then_row_is_skipped(
    client: AsyncClient,
) -> None:
    """Another request's token clears during the wait: the flagged row is FINISHED and skipped."""
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(2, ["written", "written"])
    await _set_row(
        "BP-BK-GROUP001-0",
        {"cancel_requested": True, "cancel_reason": "foreign", "cancel_flag_token": "other"},
    )

    async def settle() -> None:
        await asyncio.sleep(0.2)
        await _set_row("BP-BK-GROUP001-0", {"cancel_flag_token": None})

    settler = asyncio.create_task(settle())
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    await settler
    assert response.status_code == 200
    rows = await _rows("BK-GROUP001")
    assert (rows[0]["cancel_requested"], rows[0]["cancel_reason"]) == (True, "foreign")
    assert (rows[1]["cancel_requested"], rows[1]["cancel_reason"]) == (True, "r")
    assert await _log_statuses() == ["granted"]


async def test_cancel_group_foreign_flag_reverted_during_wait_proceeds(client: AsyncClient) -> None:
    """Another request reverts its flag during the wait: the row is OPEN again and is cancelled."""
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-0")
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(2, ["written", "written"])
    await _set_row(
        "BP-BK-GROUP001-0",
        {"cancel_requested": True, "cancel_reason": "foreign", "cancel_flag_token": "other"},
    )

    async def revert() -> None:
        await asyncio.sleep(0.2)
        await _set_row(
            "BP-BK-GROUP001-0",
            {"cancel_requested": False, "cancel_reason": None, "cancel_flag_token": None},
        )

    reverter = asyncio.create_task(revert())
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    await reverter
    assert response.status_code == 200
    rows = await _rows("BK-GROUP001")
    assert [(row["cancel_requested"], row["cancel_reason"]) for row in rows] == [
        (True, "r"),
        (True, "r"),
    ]
    assert [row["cancel_flag_token"] for row in rows] == [None, None]
    assert await _log_statuses() == ["granted"]


async def test_cancel_group_foreign_token_still_in_flight_is_409_and_changes_nothing(
    client: AsyncClient,
) -> None:
    """A foreign token that never clears: the wait times out, 409, nothing of ours is flagged."""
    await _group(2, ["pending", "written"])
    await _set_row(
        "BP-BK-GROUP001-1",
        {"cancel_requested": True, "cancel_reason": "foreign", "cancel_flag_token": "other"},
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    rows = await _rows("BK-GROUP001")
    assert (rows[0]["state"], rows[0]["cancel_requested"], rows[0]["cancel_flag_token"]) == (
        "pending",
        False,
        None,
    )
    assert (rows[1]["cancel_requested"], rows[1]["cancel_flag_token"]) == (True, "other")
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


def _settle_flag_on_final_reread(monkeypatch: pytest.MonkeyPatch, fields: dict[str, Any]) -> None:
    """Apply `fields` to row 0 right before the first `ExternalBooking.get` (the final re-read)."""
    original = ExternalBooking.get
    fired = False

    async def get(doc_id: Any, *args: Any, **kwargs: Any) -> Any:
        nonlocal fired
        if not fired:
            fired = True
            await _set_row("BP-BK-GROUP001-0", fields)
        return await original(doc_id, *args, **kwargs)

    monkeypatch.setattr(ExternalBooking, "get", get)


async def test_cancel_group_foreign_token_cleared_on_final_reread_is_skipped(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Budget spent with a foreign flag still in place: one re-read before the 409.

    The other request clears its token between the last poll and the final re-read, so the row
    is FINISHED: it is skipped and the request succeeds (200) instead of 409.
    """
    from apiapp.modules.thirdparty_bookings import use_case

    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-0")
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(2, ["written", "written"])
    await _set_row(
        "BP-BK-GROUP001-0",
        {"cancel_requested": True, "cancel_reason": "foreign", "cancel_flag_token": "other"},
    )
    monkeypatch.setattr(use_case, "_FLAG_WAIT_SECONDS", 0.0)
    _settle_flag_on_final_reread(monkeypatch, {"cancel_flag_token": None})

    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    rows = await _rows("BK-GROUP001")
    assert [(row["cancel_requested"], row["cancel_reason"]) for row in rows] == [
        (True, "foreign"),
        (True, "r"),
    ]
    assert await _log_statuses() == ["granted"]


async def test_cancel_group_foreign_flag_reverted_on_final_reread_proceeds(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Budget spent with a foreign flag still in place: the final re-read sees it reverted.

    The row is OPEN again, so this request flags and cancels it as usual (200).
    """
    from apiapp.modules.thirdparty_bookings import use_case

    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-0")
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(2, ["written", "written"])
    await _set_row(
        "BP-BK-GROUP001-0",
        {"cancel_requested": True, "cancel_reason": "foreign", "cancel_flag_token": "other"},
    )
    monkeypatch.setattr(use_case, "_FLAG_WAIT_SECONDS", 0.0)
    _settle_flag_on_final_reread(
        monkeypatch, {"cancel_requested": False, "cancel_reason": None, "cancel_flag_token": None}
    )

    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    rows = await _rows("BK-GROUP001")
    assert [(row["cancel_requested"], row["cancel_reason"]) for row in rows] == [
        (True, "r"),
        (True, "r"),
    ]
    assert [row["cancel_flag_token"] for row in rows] == [None, None]
    assert await _log_statuses() == ["granted"]


async def test_cancel_group_foreign_waits_share_one_request_budget(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """CR-169 FR-40: the wait is at most 1 s per request, not 1 s per foreign row.

    Two written rows get a foreign flag just before our flag write, so both are waited on in
    phase 2a. Row 0 settles after 0.6 s; row 1 never does. The request gives up at the shared
    1 s deadline (409). A fresh 1 s window per row would end near 1.6 s instead.
    """
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-0")
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(2, ["written", "written"])
    foreign = {"cancel_requested": True, "cancel_reason": "foreign", "cancel_flag_token": "other"}

    async def flag_both() -> None:
        await _set_row("BP-BK-GROUP001-0", foreign)
        await _set_row("BP-BK-GROUP001-1", foreign)

    async def settle_row_zero() -> None:
        await asyncio.sleep(0.6)
        await _set_row("BP-BK-GROUP001-0", {"cancel_flag_token": None})

    _around_update_many(
        monkeypatch, when=lambda flt: flt.get("cancel_requested") is False, before=flag_both
    )
    settler = asyncio.create_task(settle_row_zero())
    started = asyncio.get_running_loop().time()
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    elapsed = asyncio.get_running_loop().time() - started
    await settler
    assert response.status_code == 409
    assert response.json()["code"] == "booking_not_cancellable"
    assert elapsed < 1.3
    rows = await _rows("BK-GROUP001")
    assert [
        (row["cancel_requested"], row["cancel_reason"], row["cancel_flag_token"]) for row in rows
    ] == [(True, "foreign", None), (True, "foreign", "other")]
    assert await _log_statuses() == ["denied_booking_not_cancellable"]


async def test_cancel_group_success_clears_own_token_and_keeps_flags(client: AsyncClient) -> None:
    """A successful request flags its written rows, then clears its token; the flags stay."""
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-0")
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(2, ["written", "written"])
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    rows = await _rows("BK-GROUP001")
    assert [(row["cancel_requested"], row["cancel_flag_token"]) for row in rows] == [
        (True, None),
        (True, None),
    ]


async def test_cancel_group_revert_clears_flags_and_token(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A check-in after the flag write reverts both flags and drops the token with them."""
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-0")
    await _person(status="pre_registered", person_id="evacuee:BK-GROUP001-1")
    await _group(2, ["written", "written"])
    _around_update_many(
        monkeypatch,
        when=lambda flt: flt.get("cancel_requested") is False,
        after=lambda: _set_stay("evacuee:BK-GROUP001-1", "active"),
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 409
    rows = await _rows("BK-GROUP001")
    assert [
        (row["cancel_requested"], row["cancel_reason"], row["cancel_flag_token"]) for row in rows
    ] == [(False, None, None), (False, None, None)]


async def test_cancel_group_legacy_flag_without_token_is_finished_and_skipped(
    client: AsyncClient,
) -> None:
    """A flagged row with no token (legacy, or its request finished) is FINISHED per FR-40."""
    await _group(2, ["written", "pending"])
    await _set_row(
        "BP-BK-GROUP001-0",
        {"cancel_requested": True, "cancel_reason": "legacy", "cancel_flag_token": None},
    )
    response = await client.post(_cancel_url("BK-GROUP001"), json={"reason": "r"}, headers=GRANTED)
    assert response.status_code == 200
    rows = await _rows("BK-GROUP001")
    assert (rows[0]["cancel_requested"], rows[0]["cancel_reason"]) == (True, "legacy")
    assert (rows[1]["state"], rows[1]["cancel_reason"]) == ("cancelled", "r")
    assert await _log_statuses() == ["granted"]


async def test_clear_flag_tokens_only_clears_the_requests_own_token(
    client: AsyncClient,
) -> None:
    """The token clear is guarded on this request's token: another request's token survives."""
    from apiapp.modules.thirdparty_bookings import use_case

    rows = await _group(2, ["written", "written"])
    await _set_row("BP-BK-GROUP001-0", {"cancel_requested": True, "cancel_flag_token": "other"})
    await _set_row("BP-BK-GROUP001-1", {"cancel_requested": True, "cancel_flag_token": "mine"})
    uc = use_case.ThirdPartyBookingsUseCase()
    await uc._clear_flag_tokens(ExternalBooking.get_pymongo_collection(), rows, "mine")
    stored = await _rows("BK-GROUP001")
    assert [row["cancel_flag_token"] for row in stored] == ["other", None]
    assert [row["cancel_requested"] for row in stored] == [True, True]
