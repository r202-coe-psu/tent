"""Public volunteer job board, quick-apply and Digital Pass tests (CR-092)."""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from tent_model.public_job import PublicJob, ShiftTemplate
from tent_model.public_job_application import (
    ApplicantSnapshot,
    PublicJobApplication,
    SelectedShift,
)
from tent_model.public_shelter import PublicShelter
from tent_model.public_shift_assignment import DutyWindow, PublicShiftAssignment
from tent_model.public_volunteer import PublicVolunteer
from tent_model.shift_response_buffer import ShiftResponseBuffer
from tent_model.volunteer_application_buffer import VolunteerApplicationBuffer
from tent_model.volunteer_job_slot import VolunteerJobSlot, seed_job_slot
from tent_model.volunteer_profile_update_buffer import VolunteerProfileUpdateBuffer

from apiapp.core.config import Settings
from apiapp.modules.volunteers import router as volunteer_router
from apiapp.utils.masking import normalize_phone, sha256_hex
from apiapp.utils.response_code import normalize_response_code
from apiapp.utils.view_token import VIEW_TOKEN_TTL_SECONDS, mint_view_token

JOB_ID = "job:01JOBTEST0000000000000001"


@pytest.fixture
def auth_headers(settings: Settings) -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.EXTERNAL_API_SECRET}"}


@pytest.fixture(autouse=True)
def reset_rate_limit() -> None:
    """The router's sliding window is process-global and would leak across tests."""
    volunteer_router._rate_buckets.clear()


@pytest.fixture
async def shelter() -> PublicShelter:
    shelter = PublicShelter(
        id="SH001",
        shelter_code="SH001",
        name="ศูนย์ทดสอบ",
        status="open",
        capacity=100,
        updated_at=datetime.now(UTC),
    )
    await shelter.insert()
    return shelter


async def _make_job(
    *,
    job_id: str = JOB_ID,
    tier: str = "operational",
    auto_accept: bool = True,
    quota: int = 2,
    status: str = "open",
    skills: list[str] | None = None,
) -> PublicJob:
    now = datetime.now(UTC)
    job = PublicJob(
        id=job_id,
        shelter_code="SH001",
        title="ผู้ช่วยครัว",
        description="เตรียมอาหาร",
        tier=tier,
        skills_required=skills or [],
        quota=quota,
        slots_confirmed=0,
        slots_dispatched=0,
        slots_remaining=quota,
        shift_template=ShiftTemplate(
            shift_name="เช้า", start_time="08:00", end_time="12:00", days=["mon"]
        ),
        auto_accept=auto_accept,
        status=status,
        updated_at=now,
    )
    await job.insert()
    await seed_job_slot(job_id=job.id, shelter_code="SH001", quota=quota, now=now)
    return job


def _apply_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "first_name": "สมชาย",
        "last_name": "ใจดี",
        "phone": "0812345678",
        "national_id": "1234567890123",
        "skills": ["ครัว"],
        "shift_date": "2026-09-01",
    }
    body.update(overrides)
    return body


async def test_jobs_requires_bearer(client: AsyncClient) -> None:
    response = await client.get("/public/v1/jobs")
    assert response.status_code == 401


async def test_list_jobs_reports_live_remaining_not_the_snapshot(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(quota=3)
    # A confirmed application moves the counter; the projected job doc still says 0.
    await client.post(
        f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
    )

    response = await client.get("/public/v1/jobs", headers=auth_headers)
    assert response.status_code == 200
    job = response.json()["jobs"][0]
    assert job["slots_confirmed"] == 1
    assert job["slots_remaining"] == 2
    assert job["shelter_name"] == "ศูนย์ทดสอบ"


async def test_auto_accept_operational_job_issues_confirmed_ticket(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job()
    response = await client.post(
        f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
    )
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "confirmed"
    assert body["tracking_token"].startswith("TKT-VOL-")

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    assert slot.confirmed_qty == 1


async def test_staff_capable_job_never_auto_accepts(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """F-AUTO — a job handing out a RoleKey waits for a manager even with the flag on."""
    await _make_job(tier="staff-capable", auto_accept=True)
    response = await client.post(
        f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
    )
    assert response.json()["status"] == "pending_review"

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    # A queue of unreviewed applications must not consume the quota.
    assert slot.confirmed_qty == 0


async def test_controlled_skill_goes_to_review(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job()
    response = await client.post(
        f"/public/v1/jobs/{JOB_ID}/apply",
        json=_apply_body(skills=["พยาบาล"]),
        headers=auth_headers,
    )
    assert response.json()["status"] == "pending_review"


async def test_quota_is_not_oversubscribed_under_concurrency(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The reason the slot counter exists — two people racing the last seat."""
    await _make_job(quota=1)

    first, second = await asyncio.gather(
        client.post(
            f"/public/v1/jobs/{JOB_ID}/apply",
            json=_apply_body(phone="0810000001"),
            headers=auth_headers,
        ),
        client.post(
            f"/public/v1/jobs/{JOB_ID}/apply",
            json=_apply_body(phone="0810000002"),
            headers=auth_headers,
        ),
    )
    codes = sorted([first.status_code, second.status_code])
    assert codes == [201, 409]

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    assert slot.confirmed_qty == 1


async def test_apply_refuses_when_the_counter_was_never_seeded(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Fail closed: an unprojected job is one nobody has verified is open."""
    await _make_job()
    await (await VolunteerJobSlot.get(JOB_ID)).delete()  # type: ignore[union-attr]

    response = await client.post(
        f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
    )
    assert response.status_code == 409
    assert response.json()["errors"][0]["error"] == "JOB_NOT_READY"


async def test_apply_rejects_a_closed_job(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(status="full")
    response = await client.post(
        f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
    )
    assert response.status_code == 409


async def test_ticket_never_returns_the_national_id_and_masks_the_phone(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """FR-VOL-03.4 — the ID number must not leave the shelter's own database."""
    await _make_job()
    token = (
        await client.post(
            f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
        )
    ).json()["tracking_token"]

    response = await client.get(f"/public/v1/volunteer/ticket/{token}", headers=auth_headers)
    assert response.status_code == 200
    raw = response.text
    assert "1234567890123" not in raw
    assert "0812345678" not in raw

    ticket = response.json()["ticket"]
    assert ticket["phone_masked"] == "xxx-xxx-5678"
    assert ticket["job_title"] == "ผู้ช่วยครัว"
    assert ticket["qr_payload"] == f"/volunteer/ticket/{token}"


async def test_unknown_ticket_is_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.get("/public/v1/volunteer/ticket/TKT-VOL-NOPE", headers=auth_headers)
    assert response.status_code == 404


async def test_cancel_releases_the_confirmed_slot(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(quota=1)
    token = (
        await client.post(
            f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
        )
    ).json()["tracking_token"]

    response = await client.post(
        f"/public/v1/volunteer/ticket/{token}/cancel", headers=auth_headers
    )
    assert response.status_code == 200

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    assert slot.confirmed_qty == 0

    buffer = await VolunteerApplicationBuffer.find_one(
        VolunteerApplicationBuffer.tracking_token_hash == sha256_hex(token)
    )
    assert buffer is not None
    assert buffer.status == "cancelled"


async def test_cancelling_twice_does_not_release_two_slots(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(quota=2)
    tokens = [
        (
            await client.post(
                f"/public/v1/jobs/{JOB_ID}/apply",
                json=_apply_body(phone=f"081000000{i}"),
                headers=auth_headers,
            )
        ).json()["tracking_token"]
        for i in range(2)
    ]

    await client.post(f"/public/v1/volunteer/ticket/{tokens[0]}/cancel", headers=auth_headers)
    second = await client.post(
        f"/public/v1/volunteer/ticket/{tokens[0]}/cancel", headers=auth_headers
    )
    assert second.status_code == 409

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    # One cancellation, one slot back — the other ticket still holds its own.
    assert slot.confirmed_qty == 1


async def test_find_tickets_by_phone_does_not_confirm_an_unknown_number(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job()
    await client.post(f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers)

    hit = await client.post(
        "/public/v1/volunteer/ticket/find", json={"phone": "081-234-5678"}, headers=auth_headers
    )
    assert hit.status_code == 200
    assert len(hit.json()["tickets"]) == 1

    miss = await client.post(
        "/public/v1/volunteer/ticket/find", json={"phone": "0899999999"}, headers=auth_headers
    )
    assert miss.status_code == 200
    assert miss.json()["tickets"] == []


async def test_phone_lookup_still_returns_the_token_after_couch_sync(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The Access Portal signs a volunteer in by phone — the token must survive sync.

    Filtering the buffer on ``synced_to_couch: False`` used to drop it about three
    seconds after applying, leaving a ticket the applicant could see but not open.
    """
    await _make_job()
    token = (
        await client.post(
            f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
        )
    ).json()["tracking_token"]

    # What the worker does once it has written the application to CouchDB.
    buffer = await VolunteerApplicationBuffer.find_one(
        VolunteerApplicationBuffer.tracking_token_hash == sha256_hex(token)
    )
    assert buffer is not None
    buffer.synced_to_couch = True
    await buffer.save()

    found = await client.post(
        "/public/v1/volunteer/ticket/find", json={"phone": "0812345678"}, headers=auth_headers
    )
    tickets = found.json()["tickets"]
    assert len(tickets) == 1
    assert tickets[0]["job_title"] == "ผู้ช่วยครัว"
    # A reference, not the applicant's own token — see test_phone_lookup_* below.
    assert tickets[0]["view_token"].startswith("VIEW-")


async def test_phone_lookup_does_not_double_count_during_the_sync_window(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Projection and buffer overlap briefly; that is one ticket, not two."""
    await _make_job()
    token = (
        await client.post(
            f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
        )
    ).json()["tracking_token"]
    buffer = await VolunteerApplicationBuffer.find_one(
        VolunteerApplicationBuffer.tracking_token_hash == sha256_hex(token)
    )
    assert buffer is not None

    # The projector lands while the buffer flag has not flipped yet.
    await PublicJobApplication(
        id=buffer.id,
        shelter_code="SH001",
        job_id=JOB_ID,
        tracking_token_hash=buffer.tracking_token_hash,
        phone_hash=buffer.applicant.phone_hash,
        applicant=ApplicantSnapshot(
            first_name="สมชาย", last_name="ใจดี", phone_masked="xxx-xxx-5678", skills=["ครัว"]
        ),
        selected_shift=SelectedShift(date="2026-09-01", start_time="08:00", end_time="12:00"),
        status="pending_review",
        updated_at=datetime.now(UTC),
    ).insert()

    found = await client.post(
        "/public/v1/volunteer/ticket/find", json={"phone": "0812345678"}, headers=auth_headers
    )
    tickets = found.json()["tickets"]
    assert len(tickets) == 1
    # The projection is the system of record for status once it exists.
    assert tickets[0]["status"] == "pending_review"


async def test_phone_lookup_sorts_the_schedule_by_next_shift(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(job_id="job:01JOBTEST0000000000000002", quota=5)
    await _make_job(quota=5)
    for job_id, date in (
        ("job:01JOBTEST0000000000000002", "2026-10-05"),
        (JOB_ID, "2026-09-02"),
    ):
        await client.post(
            f"/public/v1/jobs/{job_id}/apply",
            json=_apply_body(shift_date=date),
            headers=auth_headers,
        )

    found = await client.post(
        "/public/v1/volunteer/ticket/find", json={"phone": "0812345678"}, headers=auth_headers
    )
    dates = [t["shift_date"] for t in found.json()["tickets"]]
    assert dates == ["2026-09-02", "2026-10-05"]


# ── Option C: a phone lookup may read a pass, but may not cancel one ───────────


async def _apply_and_lookup(
    client: AsyncClient, auth_headers: dict[str, str], phone: str = "0812345678"
) -> tuple[str, str]:
    """Apply, then find the same ticket by phone. Returns (tracking token, view token)."""
    token = (
        await client.post(
            f"/public/v1/jobs/{JOB_ID}/apply",
            json=_apply_body(phone=phone),
            headers=auth_headers,
        )
    ).json()["tracking_token"]
    found = await client.post(
        "/public/v1/volunteer/ticket/find", json={"phone": phone}, headers=auth_headers
    )
    return token, found.json()["tickets"][0]["view_token"]


async def test_phone_lookup_never_hands_back_the_tracking_token(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Knowing a phone number must not yield the credential that cancels a shift."""
    await _make_job()
    token, view_token = await _apply_and_lookup(client, auth_headers)
    assert view_token != token
    assert token not in view_token


async def test_view_token_opens_the_pass_read_only(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job()
    _, view_token = await _apply_and_lookup(client, auth_headers)

    response = await client.get(
        f"/public/v1/volunteer/ticket/{view_token}", headers=auth_headers
    )
    assert response.status_code == 200
    ticket = response.json()["ticket"]
    assert ticket["can_cancel"] is False
    # Still the whole card — read access is what the portal is for.
    assert ticket["job_title"] == "ผู้ช่วยครัว"
    assert ticket["phone_masked"] == "xxx-xxx-5678"


async def test_the_applicants_own_token_still_allows_cancelling(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job()
    token, _ = await _apply_and_lookup(client, auth_headers)

    ticket = (
        await client.get(f"/public/v1/volunteer/ticket/{token}", headers=auth_headers)
    ).json()["ticket"]
    assert ticket["can_cancel"] is True

    cancelled = await client.post(
        f"/public/v1/volunteer/ticket/{token}/cancel", headers=auth_headers
    )
    assert cancelled.status_code == 200


async def test_a_view_token_cannot_cancel(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The whole point of option C."""
    await _make_job()
    _, view_token = await _apply_and_lookup(client, auth_headers)

    response = await client.post(
        f"/public/v1/volunteer/ticket/{view_token}/cancel", headers=auth_headers
    )
    # 404, not 403 — "wrong kind of token" would confirm the ticket is real.
    assert response.status_code == 404

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    assert slot.confirmed_qty == 1


async def test_an_expired_view_token_is_not_accepted(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job()
    token = (
        await client.post(
            f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
        )
    ).json()["tracking_token"]
    buffer = await VolunteerApplicationBuffer.find_one(
        VolunteerApplicationBuffer.tracking_token_hash == sha256_hex(token)
    )
    assert buffer is not None

    stale = mint_view_token(buffer.id, now=time.time() - VIEW_TOKEN_TTL_SECONDS - 60)
    response = await client.get(f"/public/v1/volunteer/ticket/{stale}", headers=auth_headers)
    assert response.status_code == 404


async def test_a_forged_view_token_is_not_accepted(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Signed with the server secret — an attacker who guesses an id still gets nothing."""
    await _make_job()
    token = (
        await client.post(
            f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
        )
    ).json()["tracking_token"]
    buffer = await VolunteerApplicationBuffer.find_one(
        VolunteerApplicationBuffer.tracking_token_hash == sha256_hex(token)
    )
    assert buffer is not None

    genuine = mint_view_token(buffer.id)
    forged = f"{genuine.rsplit('.', 1)[0]}.{'A' * 43}"
    response = await client.get(f"/public/v1/volunteer/ticket/{forged}", headers=auth_headers)
    assert response.status_code == 404


# ── ตารางทำงานจิตอาสา — the roster, not the applications ──────────────────────


async def _assign(
    *,
    assignment_id: str,
    phone: str = "0812345678",
    date: str = "2026-09-01",
    start: datetime | None = None,
    status: str = "assigned",
    dispatch_status: str | None = None,
    job_id: str = JOB_ID,
) -> PublicShiftAssignment:
    now = datetime.now(UTC)
    assignment = PublicShiftAssignment(
        id=assignment_id,
        shelter_code="SH001",
        job_id=job_id,
        volunteer_id="volunteer:01VOL0000000000000000001",
        phone_hash=sha256_hex(phone),
        date=date,
        shift="custom",
        station="ครัวกลาง",
        duty_window=DutyWindow(start_ts=start or now, end_ts=now),
        status=status,
        dispatch_status=dispatch_status,
        updated_at=now,
    )
    await assignment.insert()
    return assignment


async def test_schedule_returns_shifts_the_volunteer_is_rostered_on(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job()
    await _assign(assignment_id="shift_assignment:01A", dispatch_status="dispatched")

    response = await client.post(
        "/public/v1/volunteer/schedule", json={"phone": "081-234-5678"}, headers=auth_headers
    )
    assert response.status_code == 200
    shifts = response.json()["shifts"]
    assert len(shifts) == 1
    assert shifts[0]["job_title"] == "ผู้ช่วยครัว"
    assert shifts[0]["shelter_name"] == "ศูนย์ทดสอบ"
    assert shifts[0]["station"] == "ครัวกลาง"
    # Drives the Dispatch Card's accept/decline buttons.
    assert shifts[0]["dispatch_status"] == "dispatched"


async def test_schedule_is_independent_of_whether_an_application_exists(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """A manager can assign someone directly — they never filed an application.

    A schedule built on job_application would show this volunteer nothing.
    """
    await _make_job()
    await _assign(assignment_id="shift_assignment:01B", phone="0899990000")

    tickets = await client.post(
        "/public/v1/volunteer/ticket/find", json={"phone": "0899990000"}, headers=auth_headers
    )
    assert tickets.json()["tickets"] == []

    schedule = await client.post(
        "/public/v1/volunteer/schedule", json={"phone": "0899990000"}, headers=auth_headers
    )
    assert len(schedule.json()["shifts"]) == 1


async def test_schedule_puts_the_next_shift_first(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job()
    await _assign(
        assignment_id="shift_assignment:01LATE",
        date="2026-10-01",
        start=datetime(2026, 10, 1, 8, tzinfo=UTC),
    )
    await _assign(
        assignment_id="shift_assignment:01SOON",
        date="2026-09-02",
        start=datetime(2026, 9, 2, 8, tzinfo=UTC),
    )

    response = await client.post(
        "/public/v1/volunteer/schedule", json={"phone": "0812345678"}, headers=auth_headers
    )
    assert [s["assignment_id"] for s in response.json()["shifts"]] == [
        "shift_assignment:01SOON",
        "shift_assignment:01LATE",
    ]


async def test_schedule_of_an_unknown_number_is_an_empty_list_not_a_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/public/v1/volunteer/schedule", json={"phone": "0899999999"}, headers=auth_headers
    )
    assert response.status_code == 200
    assert response.json()["shifts"] == []


# ── Answering an offered shift: phone + spoken code (CR-092 FR-VOL-06) ─────────

CODE = "4K7-2M9"


async def _offer(
    *,
    assignment_id: str = "shift_assignment:01OFFER",
    phone: str = "0812345678",
    code: str | None = CODE,
    dispatched: int = 1,
) -> PublicShiftAssignment:
    """A shift a manager has offered, with the counter holding its dispatched head."""
    await VolunteerJobSlot.get_motor_collection().update_one(
        {"_id": JOB_ID}, {"$set": {"dispatched_qty": dispatched}}
    )
    now = datetime.now(UTC)
    assignment = PublicShiftAssignment(
        id=assignment_id,
        shelter_code="SH001",
        job_id=JOB_ID,
        volunteer_id="volunteer:01VOL0000000000000000001",
        phone_hash=sha256_hex(phone),
        response_code_hash=sha256_hex(normalize_response_code(code)) if code else None,
        date="2026-09-01",
        shift="custom",
        station="ครัวกลาง",
        duty_window=DutyWindow(start_ts=now, end_ts=now),
        status="assigned",
        dispatch_status="dispatched",
        updated_at=now,
    )
    await assignment.insert()
    return assignment


async def _respond(client: AsyncClient, headers: dict[str, str], **overrides: object):
    body: dict[str, object] = {
        "assignment_id": "shift_assignment:01OFFER",
        "phone": "0812345678",
        "code": CODE,
        "action": "accepted",
    }
    body.update(overrides)
    # Exactly one credential reaches the API, so a caller overriding one drops the other.
    body = {k: v for k, v in body.items() if v is not None}
    return await client.post("/public/v1/volunteer/schedule/respond", json=body, headers=headers)


async def test_accepting_moves_the_quota_from_dispatched_to_confirmed(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(quota=5)
    await _offer()

    response = await _respond(client, auth_headers)
    assert response.status_code == 200
    assert response.json()["dispatch_status"] == "accepted"

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    # 🟡 → 🟢, never counted as both.
    assert (slot.confirmed_qty, slot.dispatched_qty) == (1, 0)

    buffer = await ShiftResponseBuffer.get("shift_assignment:01OFFER")
    assert buffer is not None
    assert buffer.action == "accepted"
    assert buffer.synced_to_couch is False


async def test_declining_gives_the_seat_back_to_the_board(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(quota=5)
    await _offer()

    response = await _respond(client, auth_headers, action="declined")
    assert response.status_code == 200

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    # 🟡 → ⚪ — remaining is derived, so releasing the dispatched head is the release.
    assert (slot.confirmed_qty, slot.dispatched_qty) == (0, 0)


async def test_the_code_alone_is_not_enough(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Someone who overheard the code but is not the volunteer gets nowhere."""
    await _make_job(quota=5)
    await _offer()

    response = await _respond(client, auth_headers, phone="0899999999")
    assert response.status_code == 404

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    assert (slot.confirmed_qty, slot.dispatched_qty) == (0, 1)


async def test_the_phone_alone_is_not_enough(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The reason a six-character code is acceptable at all."""
    await _make_job(quota=5)
    await _offer()

    response = await _respond(client, auth_headers, code="ZZZ-ZZZ")
    assert response.status_code == 404

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    assert (slot.confirmed_qty, slot.dispatched_qty) == (0, 1)


async def test_a_wrong_code_is_indistinguishable_from_an_unknown_shift(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Otherwise a caller could enumerate codes and watch the answer change."""
    await _make_job(quota=5)
    await _offer()

    wrong_code = await _respond(client, auth_headers, code="ZZZ-ZZZ")
    unknown_shift = await _respond(
        client, auth_headers, assignment_id="shift_assignment:01NOPE"
    )
    assert wrong_code.status_code == unknown_shift.status_code == 404
    assert wrong_code.json() == unknown_shift.json()


async def test_the_code_is_read_back_however_it_was_heard(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """It is spoken over a phone call, so case and spacing cannot matter."""
    await _make_job(quota=5)
    await _offer()

    response = await _respond(client, auth_headers, code=" 4k7 2m9 ")
    assert response.status_code == 200


async def test_an_offer_can_only_be_answered_once(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(quota=5)
    await _offer()

    assert (await _respond(client, auth_headers)).status_code == 200
    second = await _respond(client, auth_headers, action="declined")
    assert second.status_code == 404

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    # The second answer must not have moved anything.
    assert (slot.confirmed_qty, slot.dispatched_qty) == (1, 0)


async def test_two_taps_at_once_spend_the_offer_only_once(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """A volunteer on a bad connection taps accept twice.

    409 rather than the 404 a later retry gets: both requests pass the phone and code
    checks because neither has written yet, and it is the atomic counter move that
    separates them. That is the guard doing its job — the status differs only after
    both factors were correct, so it leaks nothing.
    """
    await _make_job(quota=5)
    await _offer()

    first, second = await asyncio.gather(
        _respond(client, auth_headers), _respond(client, auth_headers)
    )
    assert sorted([first.status_code, second.status_code]) == [200, 409]

    slot = await VolunteerJobSlot.get(JOB_ID)
    assert slot is not None
    assert (slot.confirmed_qty, slot.dispatched_qty) == (1, 0)


async def test_a_shift_that_was_never_offered_cannot_be_answered(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(quota=5)
    assignment = await _offer()
    assignment.dispatch_status = None
    await assignment.save()

    assert (await _respond(client, auth_headers)).status_code == 404


async def test_an_offer_with_no_code_cannot_be_answered(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Fail closed: an offer staff never issued a code for is not answerable."""
    await _make_job(quota=5)
    await _offer(code=None)

    assert (await _respond(client, auth_headers)).status_code == 404


async def test_the_schedule_stops_asking_once_answered(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(quota=5)
    await _offer()
    await _respond(client, auth_headers)

    schedule = await client.post(
        "/public/v1/volunteer/schedule", json={"phone": "0812345678"}, headers=auth_headers
    )
    shift = schedule.json()["shifts"][0]
    assert shift["dispatch_status"] == "accepted"
    assert shift["status"] == "standby"


# ---------------------------------------------------------------------------
# Signing in with a ticket token instead of a phone number (CR-092 หน้าจอ 6)
# ---------------------------------------------------------------------------


async def test_schedule_by_tracking_token_matches_the_phone_sign_in(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The QR on the pass is a sign-in route, not a second way to view the pass.

    A volunteer who scans their own ticket must land on the same roster the phone would
    open — a different answer per door would mean the portal shows people half their
    shifts depending on how they got in.
    """
    await _make_job()
    token, _ = await _apply_and_lookup(client, auth_headers)
    await _assign(assignment_id="shift_assignment:01A", dispatch_status="dispatched")

    by_phone = await client.post(
        "/public/v1/volunteer/schedule", json={"phone": "0812345678"}, headers=auth_headers
    )
    by_token = await client.post(
        "/public/v1/volunteer/schedule", json={"token": token}, headers=auth_headers
    )
    assert by_token.status_code == 200
    assert by_token.json()["shifts"] == by_phone.json()["shifts"]
    assert len(by_token.json()["shifts"]) == 1


async def test_schedule_by_view_token_works_too(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """A `VIEW-` reference is no weaker a key here: whoever holds one already reached it
    with the phone number, which opens the same roster."""
    await _make_job()
    _, view_token = await _apply_and_lookup(client, auth_headers)
    await _assign(assignment_id="shift_assignment:01A")

    response = await client.post(
        "/public/v1/volunteer/schedule", json={"token": view_token}, headers=auth_headers
    )
    assert response.status_code == 200
    assert len(response.json()["shifts"]) == 1


async def test_schedule_of_an_unknown_token_is_an_empty_list_not_a_404(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Same rule the phone lookup follows — a hit and a miss must look identical, or a
    token becomes something to probe for."""
    await _make_job()
    await _assign(assignment_id="shift_assignment:01A")

    response = await client.post(
        "/public/v1/volunteer/schedule",
        json={"token": "TKT-VOL-DEADBEEF"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["shifts"] == []


async def test_ticket_find_by_token_returns_the_same_tickets_and_a_masked_phone(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job()
    token, _ = await _apply_and_lookup(client, auth_headers)

    response = await client.post(
        "/public/v1/volunteer/ticket/find", json={"token": token}, headers=auth_headers
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["tickets"]) == 1
    # The portal has no other way to say who is signed in on a token sign-in, and what it
    # shows must still be masked (AC-VOL-03).
    assert body["phone_masked"].endswith("5678")
    assert "0812345678" not in response.text


async def test_a_lookup_needs_exactly_one_credential(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """Neither is unanswerable; both at once is ambiguous — and a request that sent both
    would silently follow whichever the server happened to check first."""
    neither = await client.post(
        "/public/v1/volunteer/schedule", json={}, headers=auth_headers
    )
    both = await client.post(
        "/public/v1/volunteer/schedule",
        json={"phone": "0812345678", "token": "TKT-VOL-X"},
        headers=auth_headers,
    )
    assert neither.status_code == 422
    assert both.status_code == 422


async def test_answering_an_offer_works_with_a_token_sign_in(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job(quota=5)
    token, _ = await _apply_and_lookup(client, auth_headers)
    await _offer()

    response = await _respond(client, auth_headers, phone=None, token=token)
    assert response.status_code == 200
    assert response.json()["dispatch_status"] == "accepted"


async def test_someone_elses_token_cannot_answer_your_offer(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The code is only safe because the caller must also be the right volunteer — a
    token swaps in for the phone, it does not replace that check."""
    await _make_job(quota=5)
    stranger_token, _ = await _apply_and_lookup(client, auth_headers, phone="0899990000")
    await _offer()

    response = await _respond(client, auth_headers, phone=None, token=stranger_token)
    assert response.status_code == 404
    assert response.json()["errors"][0]["error"] == "OFFER_NOT_FOUND"


async def test_token_sign_in_still_resolves_once_the_projection_exists(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    """The two stores keep the lookup hash in different places.

    The projection indexes it at the document root; only the buffer carries it inside the
    applicant snapshot. Reading it from the wrong one is invisible in a fresh database —
    the buffer answers first — and starts failing exactly when the worker catches up.
    """
    await _make_job()
    token = (
        await client.post(
            f"/public/v1/jobs/{JOB_ID}/apply", json=_apply_body(), headers=auth_headers
        )
    ).json()["tracking_token"]
    buffer = await VolunteerApplicationBuffer.find_one(
        VolunteerApplicationBuffer.tracking_token_hash == sha256_hex(token)
    )
    assert buffer is not None
    await PublicJobApplication(
        id=buffer.id,
        shelter_code="SH001",
        job_id=JOB_ID,
        tracking_token_hash=buffer.tracking_token_hash,
        phone_hash=buffer.applicant.phone_hash,
        applicant=ApplicantSnapshot(
            first_name="สมชาย", last_name="ใจดี", phone_masked="xxx-xxx-5678", skills=["ครัว"]
        ),
        selected_shift=SelectedShift(date="2026-09-01", start_time="08:00", end_time="12:00"),
        status="confirmed",
        updated_at=datetime.now(UTC),
    ).insert()
    await _assign(assignment_id="shift_assignment:01A")

    response = await client.post(
        "/public/v1/volunteer/schedule", json={"token": token}, headers=auth_headers
    )
    assert response.status_code == 200
    assert len(response.json()["shifts"]) == 1


# ---------------------------------------------------------------------------
# The volunteer's own profile (Access Portal edit screen)
# ---------------------------------------------------------------------------


async def _profile_row(
    *,
    volunteer_id: str = "volunteer:01VOL0000000000000000001",
    shelter_code: str = "SH001",
    phone: str = "0812345678",
    skills: list[str] | None = None,
    identity_verified: bool = False,
    updated_at: datetime | None = None,
) -> PublicVolunteer:
    row = PublicVolunteer(
        id=volunteer_id,
        shelter_code=shelter_code,
        phone_hash=sha256_hex(normalize_phone(phone)),
        first_name="สมชาย",
        last_name="ใจดี",
        phone_masked="xxx-xxx-5678",
        volunteer_code="V-001",
        skills=skills if skills is not None else ["ครัว"],
        identity_verified=identity_verified,
        updated_at=updated_at or datetime.now(UTC),
    )
    await row.insert()
    return row


async def _get_profile(client: AsyncClient, headers: dict[str, str], **body: object):
    return await client.post("/public/v1/volunteer/profile", json=body, headers=headers)


async def _update_profile(client: AsyncClient, headers: dict[str, str], **body: object):
    return await client.post("/public/v1/volunteer/profile/update", json=body, headers=headers)


async def test_profile_of_an_unknown_number_is_null_not_a_404(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Same rule as every other read here — a hit and a miss must be indistinguishable."""
    response = await _get_profile(client, auth_headers, phone="0899999999")
    assert response.status_code == 200
    assert response.json()["profile"] is None


async def test_profile_never_carries_the_id_number_or_a_raw_phone(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _profile_row()
    response = await _get_profile(client, auth_headers, phone="0812345678")
    assert response.status_code == 200
    assert "0812345678" not in response.text
    assert "national_id" not in response.text
    assert response.json()["profile"]["phone_masked"] == "xxx-xxx-5678"


async def test_profile_merges_every_shelter_the_person_helps_at(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """`volunteer` is per-shelter, the person is not.

    Taking only the newest row would drop the skills the first shelter recorded, and
    would drop a verification a second shelter has not repeated.
    """
    await _profile_row(
        volunteer_id="volunteer:01OLD",
        shelter_code="SH001",
        skills=["ครัว"],
        identity_verified=True,
        updated_at=datetime(2026, 8, 1, tzinfo=UTC),
    )
    await _profile_row(
        volunteer_id="volunteer:01NEW",
        shelter_code="SH002",
        skills=["ขับรถ"],
        identity_verified=False,
        updated_at=datetime(2026, 9, 1, tzinfo=UTC),
    )

    profile = (await _get_profile(client, auth_headers, phone="0812345678")).json()["profile"]
    assert profile["skills"] == ["ขับรถ", "ครัว"]
    assert profile["identity_verified"] is True
    assert sorted(profile["shelter_codes"]) == ["SH001", "SH002"]


async def test_updating_skills_queues_one_write_per_profile_and_shows_it_at_once(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _profile_row(volunteer_id="volunteer:01A", shelter_code="SH001")
    await _profile_row(volunteer_id="volunteer:01B", shelter_code="SH002")

    response = await _update_profile(
        client, auth_headers, phone="0812345678", skills=["ครัว", "ขับรถ"]
    )
    assert response.status_code == 200
    body = response.json()
    assert body["updated"] == 2
    # Echoed back immediately: CouchDB is the system of record and the worker will get
    # there in seconds, but the volunteer is looking at the screen now.
    assert body["profile"]["skills"] == ["ครัว", "ขับรถ"]

    queued = await VolunteerProfileUpdateBuffer.find_all().to_list()
    assert len(queued) == 1
    assert queued[0].synced_to_couch is False
    assert sorted(t.volunteer_id for t in queued[0].targets) == ["volunteer:01A", "volunteer:01B"]


async def test_updating_normalises_the_skills_it_stores(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _profile_row()
    body = (
        await _update_profile(
            client, auth_headers, phone="0812345678", skills=[" ครัว ", "ครัว", "", "ขับรถ"]
        )
    ).json()
    assert body["profile"]["skills"] == ["ครัว", "ขับรถ"]


async def test_updating_a_profile_that_does_not_exist_is_refused_not_silently_accepted(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A read may answer emptily; a write may not.

    Telling someone their edit was saved when there was nothing to save is worse than a
    404 — there is no other screen where they would find out.
    """
    response = await _update_profile(client, auth_headers, phone="0899999999", skills=["ครัว"])
    assert response.status_code == 404
    assert response.json()["errors"][0]["error"] == "PROFILE_NOT_FOUND"


async def test_a_profile_edit_cannot_express_a_staff_only_change(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """`identity_verified` and friends are not on the request model at all, so a forged
    body carrying them changes nothing."""
    await _profile_row(identity_verified=False)
    await _update_profile(
        client,
        auth_headers,
        phone="0812345678",
        skills=["ครัว"],
        identity_verified=True,
        volunteer_code="V-999",
        status="inactive",
    )
    profile = (await _get_profile(client, auth_headers, phone="0812345678")).json()["profile"]
    assert profile["identity_verified"] is False
    assert profile["volunteer_code"] == "V-001"


async def test_a_token_sign_in_can_read_and_edit_the_same_profile(
    client: AsyncClient, shelter: PublicShelter, auth_headers: dict[str, str]
) -> None:
    await _make_job()
    token, _ = await _apply_and_lookup(client, auth_headers)
    await _profile_row()

    assert (await _get_profile(client, auth_headers, token=token)).json()["profile"] is not None
    updated = await _update_profile(client, auth_headers, token=token, skills=["ขับรถ"])
    assert updated.status_code == 200
    assert updated.json()["profile"]["skills"] == ["ขับรถ"]
