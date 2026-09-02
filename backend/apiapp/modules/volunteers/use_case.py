"""Public volunteer job board, quick-apply and Digital Pass (CR-092 FR-VOL-02/03)."""

from __future__ import annotations

import hmac
import logging
import secrets
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError
from tent_model.public_job import PublicJob
from tent_model.public_job_application import PublicJobApplication
from tent_model.public_shelter import PublicShelter
from tent_model.public_shift_assignment import PublicShiftAssignment
from tent_model.public_volunteer import PublicVolunteer
from tent_model.shift_response_buffer import ShiftResponseBuffer
from tent_model.volunteer_application_buffer import (
    ApplicantBuffer,
    SelectedShiftBuffer,
    VolunteerApplicationBuffer,
)
from tent_model.volunteer_job_slot import (
    SlotResult,
    VolunteerJobSlot,
    accept_dispatched_slot,
    decline_dispatched_slot,
    release_job_slot,
    reserve_job_slot,
)
from tent_model.volunteer_profile_update_buffer import (
    ProfileUpdateTarget,
    VolunteerProfileUpdateBuffer,
)

from ...utils.masking import mask_phone, national_id_hash, normalize_phone, sha256_hex
from ...utils.response_code import normalize_response_code
from ...utils.ulid import new_ulid
from ...utils.view_token import is_view_token, mint_view_token, resolve_view_token
from .schemas import (
    DispatchRespondResponse,
    JobShiftTemplate,
    PublicJobItem,
    PublicJobListResponse,
    ScheduleShift,
    TicketFindItem,
    TicketFindResponse,
    TicketShift,
    VolunteerApplyRequest,
    VolunteerApplyResponse,
    VolunteerCancelResponse,
    VolunteerProfile,
    VolunteerProfileResponse,
    VolunteerProfileUpdateResponse,
    VolunteerScheduleResponse,
    VolunteerTicket,
    VolunteerTicketResponse,
)

logger = logging.getLogger(__name__)

#: Jobs a member of the public may see and apply to. Mirrors the projector's
#: ``PUBLIC_JOB_STATUSES`` — kept as its own constant because ``full`` belongs on the
#: board (greyed out, "ใกล้เต็ม" / "เต็ม") but must not accept an application.
_BOARD_STATUSES = frozenset({"open", "almost_full", "full"})
_APPLICABLE_STATUSES = frozenset({"open", "almost_full"})

#: Skills that need a manager to check a licence before the ticket is worth anything
#: (FR-VOL-02.4). Deliberately a floor, not the whole policy: Master Data
#: ``volunteer_skills`` is authoritative (CR-100) and reaches this service as the
#: projected ``config:volunteer_skills`` documents; this list is what the gate falls
#: back to while nothing has been projected yet — reviewing these beats auto-accepting
#: them.
DEFAULT_CONTROLLED_SKILLS = frozenset(
    {
        "แพทย์",
        "พยาบาล",
        "เภสัชกร",
        "ปฐมพยาบาล",
        "นักจิตวิทยา",
        "กู้ภัย",
        "ขับรถฉุกเฉิน",
    }
)

_PUBLIC_CONFIG_COLLECTION = "public_config"
_APP_CONFIG_ID = "config:app"
#: Master Data ``volunteer_skills`` as the worker projects it (CR-100): the global list
#: under this id, a shelter's own under ``…:{SHELTER}``.
_VOLUNTEER_SKILLS_CONFIG_ID = "config:volunteer_skills"

#: Statuses a ticket can still be cancelled from. A cancelled ticket stays cancelled;
#: re-cancelling must not release a second slot.
_CANCELLABLE_STATUSES = frozenset({"confirmed", "pending_review"})


def _config_values(doc: dict | None, *fields: str) -> list[str]:
    """Non-empty strings across ``fields`` of one projected config document."""
    if not doc:
        return []
    out: list[str] = []
    for field in fields:
        value = doc.get(field)
        if isinstance(value, list):
            out.extend(str(v).strip() for v in value if str(v).strip())
    return out


async def controlled_skills(shelter_code: str | None = None) -> frozenset[str]:
    """Controlled-skill values for a shelter: Master Data first, then the floor.

    Same bridge the donation TTL uses: the list is staff-authored in CouchDB, which this
    service cannot read, so the worker projects it into ``public_config`` (CR-100).

    Resolution order, first hit wins:

    1. ``config:volunteer_skills`` ∪ ``config:volunteer_skills:{SHELTER}`` — Master Data
       is authoritative, and a skill controlled at either level counts, so a centre can
       add a controlled skill of its own without waiting for the global list.
    2. ``config:app.volunteer_controlled_skills`` — the pre-CR-100 hand-maintained list.
    3. :data:`DEFAULT_CONTROLLED_SKILLS`.

    Both codes and labels come back: documents store master codes from CR-100 on, while
    ``volunteer.skills`` (and every application written before it) still holds labels.
    """
    try:
        collection = PublicJob.get_motor_collection().database[_PUBLIC_CONFIG_COLLECTION]
        ids = [_VOLUNTEER_SKILLS_CONFIG_ID]
        if shelter_code:
            ids.append(f"{_VOLUNTEER_SKILLS_CONFIG_ID}:{shelter_code.upper()}")
        skill_docs = await collection.find({"_id": {"$in": ids}}).to_list(length=len(ids))
        app_doc = await collection.find_one({"_id": _APP_CONFIG_ID})
    except Exception:
        logger.warning(
            "Could not read %s — using default controlled skills",
            _PUBLIC_CONFIG_COLLECTION,
        )
        return DEFAULT_CONTROLLED_SKILLS

    from_master: list[str] = []
    for doc in skill_docs or []:
        from_master.extend(_config_values(doc, "controlled_codes", "controlled_labels"))
    if from_master:
        return frozenset(from_master)

    configured = _config_values(app_doc, "volunteer_controlled_skills")
    if configured:
        return frozenset(configured)
    return DEFAULT_CONTROLLED_SKILLS


def _needs_review(job: PublicJob, skills: list[str], controlled: frozenset[str]) -> bool:
    """Whether this application must wait for a manager.

    Three independent reasons, any one of which is enough:

    1. ``staff-capable`` — the job hands out a RoleKey during the shift, and F-AUTO
       forbids auto-accepting onto one no matter what the job's own flag says.
    2. The applicant claims a controlled skill; the licence is checked by a human.
    3. The job simply has auto-accept off, which is the default for every job.
    """
    if job.tier == "staff-capable":
        return True
    if any(skill.strip() in controlled for skill in skills):
        return True
    return not job.auto_accept


async def _shelter_names(codes: set[str]) -> dict[str, str]:
    if not codes:
        return {}
    shelters = await PublicShelter.find({"shelter_code": {"$in": sorted(codes)}}).to_list()
    return {s.shelter_code: s.name for s in shelters}


def _iso(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _clean_skills(skills: list[str]) -> list[str]:
    """Trim, drop blanks, and keep the first occurrence of each.

    Order is the volunteer's own — the master list renders them in its own order anyway,
    and preserving what was sent keeps a re-read identical to what was just saved.
    """
    cleaned: list[str] = []
    for skill in skills:
        value = skill.strip()
        if value and value not in cleaned:
            cleaned.append(value)
    return cleaned


def _ticket_url(token: str) -> str:
    """Relative on purpose — the public origin belongs to the BFF, not this service."""
    return f"/volunteer/ticket/{token}"


class VolunteersUseCase:
    async def list_jobs(
        self, *, shelter_code: str | None = None, skill: str | None = None
    ) -> PublicJobListResponse:
        query: dict[str, object] = {"status": {"$in": sorted(_BOARD_STATUSES)}}
        if shelter_code:
            query["shelter_code"] = shelter_code.upper()
        if skill:
            query["skills_required"] = skill

        jobs = await PublicJob.find(query).to_list()
        names = await _shelter_names({job.shelter_code for job in jobs})
        controlled = await controlled_skills()

        # One read of the live counters rather than trusting the projected snapshot:
        # the snapshot only moves when staff edit the job, so between edits it would
        # keep advertising slots that public applications have already taken.
        slots = await VolunteerJobSlot.find({"_id": {"$in": [job.id for job in jobs]}}).to_list()
        by_id = {slot.id: slot for slot in slots}

        items: list[PublicJobItem] = []
        for job in jobs:
            slot = by_id.get(job.id)
            confirmed = slot.confirmed_qty if slot else job.slots_confirmed
            dispatched = slot.dispatched_qty if slot else job.slots_dispatched
            quota = slot.quota if slot else job.quota
            items.append(
                PublicJobItem(
                    job_id=job.id,
                    shelter_code=job.shelter_code,
                    shelter_name=names.get(job.shelter_code, ""),
                    title=job.title,
                    description=job.description,
                    tier=job.tier,
                    skills_required=job.skills_required,
                    shift_template=JobShiftTemplate(**job.shift_template.model_dump()),
                    quota=quota,
                    slots_confirmed=confirmed,
                    slots_remaining=max(quota - confirmed - dispatched, 0),
                    status=job.status,
                    requires_review=_needs_review(job, [], controlled),
                )
            )
        items.sort(key=lambda item: (item.shelter_code, item.title))
        return PublicJobListResponse(jobs=items)

    async def apply(self, job_id: str, payload: VolunteerApplyRequest) -> VolunteerApplyResponse:
        job = await PublicJob.get(job_id)
        if job is None or job.status not in _BOARD_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "JOB_NOT_FOUND"},
            )
        if job.status not in _APPLICABLE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"success": False, "error": "JOB_CLOSED"},
            )

        controlled = await controlled_skills(job.shelter_code)
        needs_review = _needs_review(job, payload.skills, controlled)

        now = datetime.now(UTC)
        application_id = f"job_application:{new_ulid()}"
        # Six bytes is what makes TKT-VOL-475939-shaped ids in CR-092 readable, but a
        # ticket is a bearer credential for someone's PII — 128 bits, and the readable
        # part stays the ULID-derived document id the shelter quotes.
        token = f"TKT-VOL-{secrets.token_hex(16).upper()}"
        token_hash = sha256_hex(token)

        # Reserve before writing anything. A pending_review application holds no slot:
        # CR-092 counts only Accepted (🟢) and Dispatched (🟡) against the quota, and a
        # queue of unreviewed applications must not lock the board.
        reserved = False
        if not needs_review:
            result = await reserve_job_slot(job_id=job_id, now=now)
            if result is SlotResult.JOB_FULL:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"success": False, "error": "JOB_FULL"},
                )
            if result is SlotResult.NOT_SEEDED:
                # Fail closed, unlike donations. There the counter guards a quantity and
                # a missing counter costs over-collection of goods; here it guards how
                # many strangers are told to turn up at a shelter, and a job the worker
                # has not projected yet is a job nobody has verified is open.
                logger.warning("volunteer_job_slot missing for %s — refusing to apply", job_id)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"success": False, "error": "JOB_NOT_READY"},
                )
            reserved = True

        template = job.shift_template
        buffer = VolunteerApplicationBuffer(
            id=application_id,
            shelter_code=job.shelter_code,
            job_id=job_id,
            volunteer_id=f"volunteer:{new_ulid()}",
            applicant=ApplicantBuffer(
                first_name=payload.first_name.strip(),
                last_name=payload.last_name.strip(),
                phone=payload.phone.strip(),
                phone_hash=sha256_hex(normalize_phone(payload.phone)),
                national_id=payload.national_id.strip() if payload.national_id else None,
                national_id_hash=(
                    national_id_hash(payload.national_id) if payload.national_id else None
                ),
                email=payload.email.strip() if payload.email else None,
                skills=[s.strip() for s in payload.skills if s.strip()],
            ),
            selected_shift=SelectedShiftBuffer(
                date=payload.shift_date or "",
                start_time=template.start_time,
                end_time=template.end_time,
                station=payload.station,
            ),
            tracking_token=token,
            tracking_token_hash=token_hash,
            status="pending_review" if needs_review else "confirmed",
            synced_to_couch=False,
            created_at=now,
        )

        try:
            await buffer.insert()
        except DuplicateKeyError:
            # Unique on tracking_token_hash. A fresh 128-bit token collided, or the same
            # request was retried — either way this application does not exist, so give
            # back the slot rather than leaving it held by nothing.
            if reserved:
                await release_job_slot(job_id=job_id, now=now)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"success": False, "error": "DUPLICATE_APPLICATION"},
            ) from None
        except Exception:
            if reserved:
                await release_job_slot(job_id=job_id, now=now)
            raise

        return VolunteerApplyResponse(
            tracking_token=token,
            status=buffer.status,
            job_id=job_id,
        )

    async def _phone_hash_for(self, *, phone: str | None, token: str | None) -> str | None:
        """The one key every portal read is answered by.

        A phone is hashed directly. A token is resolved to the application it opens and
        the hash is taken from there, so a token sign-in reaches exactly the same rows a
        phone sign-in would — the portal must not show a different roster depending on
        which door the volunteer came through (CR-092 หน้าจอ 6).

        ``None`` means "no such volunteer", which every caller answers as an empty
        result rather than a 404: a hit and a miss have to be indistinguishable, or this
        becomes a probe for whether a number is registered. Sending neither credential —
        or both, which would silently follow whichever was checked first — is the
        caller's own bug and is refused outright.
        """
        if bool(phone) == bool(token):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"success": False, "error": "INVALID_CREDENTIAL"},
            )
        if phone:
            return sha256_hex(normalize_phone(phone))
        if not token:
            return None

        if is_view_token(token):
            application_id = resolve_view_token(token)
            if not application_id:
                return None
            projected = await PublicJobApplication.get(application_id)
            # The projection keeps the hash at the root (it is the indexed lookup key);
            # only the buffer carries it inside the applicant snapshot.
            if projected is not None and projected.phone_hash:
                return projected.phone_hash
            buffer = await VolunteerApplicationBuffer.get(application_id)
            return buffer.applicant.phone_hash if buffer else None

        token_hash = sha256_hex(token)
        projected = await PublicJobApplication.find_one(
            PublicJobApplication.tracking_token_hash == token_hash
        )
        if projected is not None and projected.phone_hash:
            return projected.phone_hash
        buffer = await VolunteerApplicationBuffer.find_one(
            VolunteerApplicationBuffer.tracking_token_hash == token_hash
        )
        return buffer.applicant.phone_hash if buffer else None

    async def get_ticket(self, token: str) -> VolunteerTicketResponse:
        """Open one pass, by the applicant's tracking token or a phone-lookup reference.

        Both routes render the same card; only the reference route drops the ability to
        cancel, because it is reachable by anyone who knows the phone number.
        """
        # A view reference names its application directly; a tracking token is only ever
        # matched by hash, so the raw value is never compared against stored data.
        can_cancel = not is_view_token(token)
        if can_cancel:
            token_hash = sha256_hex(token)
            projected = await PublicJobApplication.find_one(
                PublicJobApplication.tracking_token_hash == token_hash
            )
            buffer = await VolunteerApplicationBuffer.find_one(
                VolunteerApplicationBuffer.tracking_token_hash == token_hash
            )
        else:
            application_id = resolve_view_token(token)
            # Forged, malformed and expired all land here and all answer 404 below, so a
            # probe cannot learn which of the three it hit.
            projected = await PublicJobApplication.get(application_id) if application_id else None
            buffer = (
                await VolunteerApplicationBuffer.get(application_id) if application_id else None
            )
        if projected is None and buffer is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "TICKET_NOT_FOUND"},
            )

        # Prefer the projection: once the shelter has reviewed the application, CouchDB
        # is the system of record and the buffer's status is stale.
        if projected is not None:
            shelter_code = projected.shelter_code
            job_id = projected.job_id
            applicant_name = f"{projected.applicant.first_name} {projected.applicant.last_name}"
            phone_masked = projected.applicant.phone_masked
            skills = projected.applicant.skills
            shift = TicketShift(**projected.selected_shift.model_dump())
            ticket_status = projected.status
            applied_at = projected.updated_at
        else:
            assert buffer is not None
            shelter_code = buffer.shelter_code
            job_id = buffer.job_id
            applicant_name = f"{buffer.applicant.first_name} {buffer.applicant.last_name}"
            phone_masked = mask_phone(buffer.applicant.phone)
            skills = buffer.applicant.skills
            shift = TicketShift(**buffer.selected_shift.model_dump())
            ticket_status = buffer.status
            applied_at = buffer.created_at

        job = await PublicJob.get(job_id)
        shelter = await PublicShelter.find_one(PublicShelter.shelter_code == shelter_code)

        return VolunteerTicketResponse(
            ticket=VolunteerTicket(
                token=token,
                can_cancel=can_cancel,
                status=ticket_status,
                job_id=job_id,
                job_title=job.title if job else "",
                shelter_code=shelter_code,
                shelter_name=shelter.name if shelter else "",
                applicant_name=applicant_name.strip(),
                phone_masked=phone_masked,
                skills=list(skills),
                selected_shift=shift,
                applied_at=applied_at.isoformat().replace("+00:00", "Z"),
                qr_payload=_ticket_url(token),
            )
        )

    async def find_tickets(
        self, *, phone: str | None = None, token: str | None = None
    ) -> TicketFindResponse:
        """Resolve a phone number — or a token already in hand — to that person's tickets.

        This is how a volunteer gets back into the Access Portal (CR-092 §2.1.1 — a
        volunteer signs in with the phone number they applied with, or a ticket code;
        they have no ``_users`` account). It therefore has to return a usable token,
        not just a list of things they cannot open.

        Two collections are merged because neither is complete on its own:

        * the **projection** carries the live status — once a manager reviews an
          application, CouchDB is the system of record and the buffer is stale;
        * the **buffer** is the only place the raw token exists. The projection stores
          a hash, deliberately: a staff read of the shelter's own documents must not
          hand out someone's bearer credential.

        Joined on the application id, which both share. A ticket whose buffer has been
        cleared by retention comes back with an empty token — the applicant keeps their
        URL, we no longer hold a way to re-issue it.

        Returns an empty list rather than a 404 on a miss, and the response shape is
        identical either way, so this cannot be used to probe whether a number is known.
        """
        hashed = await self._phone_hash_for(phone=phone, token=token)
        if hashed is None:
            return TicketFindResponse()
        projected = await PublicJobApplication.find(
            PublicJobApplication.phone_hash == hashed
        ).to_list()
        # Every row, not just the unsynced ones. Filtering on ``synced_to_couch: False``
        # meant the token vanished about three seconds after applying — exactly when the
        # applicant comes back to look for it.
        buffers = await VolunteerApplicationBuffer.find({"applicant.phone_hash": hashed}).to_list()

        # Keyed by application id so a row present in both — the window between the
        # CouchDB write and the buffer flag flipping — is one ticket, not two.
        merged: dict[str, TicketFindItem] = {}

        for b in buffers:
            merged[b.id] = TicketFindItem(
                view_token=mint_view_token(b.id),
                applicant_name=f"{b.applicant.first_name} {b.applicant.last_name}".strip(),
                status=b.status,
                job_title="",
                shelter_code=b.shelter_code,
                shift_date=b.selected_shift.date,
            )
        for a in projected:
            merged[a.id] = TicketFindItem(
                view_token=mint_view_token(a.id),
                applicant_name=f"{a.applicant.first_name} {a.applicant.last_name}".strip(),
                # The projection wins on status: a manager may have confirmed or
                # rejected this since the buffer was written.
                status=a.status,
                job_title="",
                shelter_code=a.shelter_code,
                shift_date=a.selected_shift.date,
            )

        job_ids = {a.job_id for a in projected} | {b.job_id for b in buffers}
        jobs = await PublicJob.find({"_id": {"$in": sorted(job_ids)}}).to_list()
        titles = {job.id: job.title for job in jobs}
        job_by_application = {a.id: a.job_id for a in projected} | {b.id: b.job_id for b in buffers}
        for application_id, item in merged.items():
            item.job_title = titles.get(job_by_application.get(application_id, ""), "")

        # Soonest shift first — this list is the volunteer's schedule, and the shift
        # they need to be reminded of is the next one. Undated entries sort last.
        tickets = sorted(
            merged.values(), key=lambda t: (t.shift_date == "", t.shift_date, t.shelter_code)
        )
        # Masked, never raw: this is echoed to a browser that may have signed in with a
        # token and therefore does not hold the number (FR-VOL-03.4 / AC-VOL-03).
        phone_masked = ""
        if projected:
            phone_masked = projected[0].applicant.phone_masked
        elif buffers:
            phone_masked = mask_phone(buffers[0].applicant.phone)
        return TicketFindResponse(tickets=tickets, phone_masked=phone_masked)

    async def schedule(
        self, *, phone: str | None = None, token: str | None = None
    ) -> VolunteerScheduleResponse:
        """The volunteer's roster — every shift they hold, soonest first.

        Reads ``shift_assignment``, not ``job_application``: an application is a request
        a manager may still be considering, whereas this is what the volunteer is
        expected to turn up for. A volunteer assigned directly by a manager has no
        application at all and would be invisible to a ticket-based schedule.

        Keyed on the phone hash, like the ticket lookup, and equally unable to say
        whether a number is known — a miss is an empty list.
        """
        hashed = await self._phone_hash_for(phone=phone, token=token)
        if hashed is None:
            return VolunteerScheduleResponse()
        assignments = await PublicShiftAssignment.find(
            PublicShiftAssignment.phone_hash == hashed
        ).to_list()
        if not assignments:
            return VolunteerScheduleResponse()

        jobs = await PublicJob.find(
            {"_id": {"$in": sorted({a.job_id for a in assignments})}}
        ).to_list()
        titles = {job.id: job.title for job in jobs}
        names = await _shelter_names({a.shelter_code for a in assignments})

        shifts = [
            ScheduleShift(
                assignment_id=a.id,
                job_id=a.job_id,
                job_title=titles.get(a.job_id, ""),
                shelter_code=a.shelter_code,
                shelter_name=names.get(a.shelter_code, ""),
                date=a.date,
                shift=a.shift,
                station=a.station,
                start_ts=_iso(a.duty_window.start_ts),
                end_ts=_iso(a.duty_window.end_ts),
                check_in_at=_iso(a.check_in_at),
                check_out_at=_iso(a.check_out_at),
                status=a.status,
                dispatch_status=a.dispatch_status,
            )
            for a in assignments
        ]
        # Next shift first — the one the volunteer needs to act on. Entries with no duty
        # window fall back to the date, and undated ones sort last rather than to the
        # top, where they would push a real upcoming shift out of sight.
        shifts.sort(key=lambda s: (s.start_ts is None and s.date == "", s.start_ts or s.date))
        return VolunteerScheduleResponse(shifts=shifts)

    async def profile(
        self, *, phone: str | None = None, token: str | None = None
    ) -> VolunteerProfileResponse:
        """The volunteer's own profile, merged across the shelters they hold one at.

        Answers ``profile: null`` for a credential that resolves to nobody — the same
        shape a known volunteer gets, so this cannot be used to probe who is registered.
        """
        hashed = await self._phone_hash_for(phone=phone, token=token)
        if hashed is None:
            return VolunteerProfileResponse()
        profile = await self._merged_profile(hashed)
        return VolunteerProfileResponse(profile=profile)

    async def update_profile(
        self, *, skills: list[str], phone: str | None = None, token: str | None = None
    ) -> VolunteerProfileUpdateResponse:
        """Queue a profile edit for every ``volunteer`` document this person holds.

        The write itself belongs to the worker — CouchDB is the system of record and the
        public plane cannot reach it — so this records the request and reflects it in the
        read model straight away, because the volunteer is looking at the screen now. If
        the worker later loses a revision race, the next pass re-reads and re-applies.

        A credential that resolves to nobody is refused rather than answered emptily:
        unlike a read, there is nothing here that a stranger could mistake for their own
        data, and a silent success would tell the volunteer their edit was saved.
        """
        hashed = await self._phone_hash_for(phone=phone, token=token)
        rows = (
            await PublicVolunteer.find(PublicVolunteer.phone_hash == hashed).to_list()
            if hashed
            else []
        )
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "PROFILE_NOT_FOUND"},
            )

        cleaned = _clean_skills(skills)
        now = datetime.now(UTC)
        await VolunteerProfileUpdateBuffer(
            id=f"volunteer_profile_update:{new_ulid()}",
            phone_hash=str(hashed),
            targets=[
                ProfileUpdateTarget(shelter_code=row.shelter_code, volunteer_id=row.id)
                for row in rows
            ],
            skills=cleaned,
            requested_at=now,
            synced_to_couch=False,
        ).insert()

        for row in rows:
            row.skills = cleaned
            row.updated_at = now
            await row.save()

        return VolunteerProfileUpdateResponse(
            updated=len(rows), profile=await self._merged_profile(str(hashed))
        )

    async def _merged_profile(self, phone_hash_value: str) -> VolunteerProfile | None:
        rows = await PublicVolunteer.find(PublicVolunteer.phone_hash == phone_hash_value).to_list()
        if not rows:
            return None
        # Newest first: the most recently touched document is the one whose name and
        # contact details the shelters have seen most recently.
        rows.sort(key=lambda r: r.updated_at, reverse=True)
        newest = rows[0]
        # Skills are a union rather than the newest row's: they describe the person, and
        # a profile created by a second shelter's walk-in desk starts empty — taking only
        # the newest would silently drop what the first shelter recorded.
        skills: list[str] = []
        for row in rows:
            for skill in row.skills:
                if skill not in skills:
                    skills.append(skill)
        return VolunteerProfile(
            first_name=newest.first_name,
            last_name=newest.last_name,
            nickname=newest.nickname,
            phone_masked=newest.phone_masked,
            email=newest.email,
            volunteer_code=newest.volunteer_code,
            skills=skills,
            organization=newest.organization,
            # True if ANY shelter has verified them — verification is about the person,
            # and a second shelter's fresh profile has not repeated the check.
            identity_verified=any(row.identity_verified for row in rows),
            personnel_type=newest.personnel_type,
            shelter_codes=[row.shelter_code for row in rows],
        )

    async def respond_to_dispatch(
        self,
        *,
        assignment_id: str,
        code: str,
        action: str,
        phone: str | None = None,
        token: str | None = None,
    ) -> DispatchRespondResponse:
        """Accept or decline an offered shift (CR-092 FR-VOL-06).

        Both factors are checked against the same record and a miss on either answers
        404 — never "wrong code", which would confirm the assignment exists and let a
        caller who knows a phone number enumerate codes with feedback.

        Quota moves in one atomic update (🟡 → 🟢 on accept, 🟡 → ⚪ on decline) before
        anything is written down, so two taps of the same button cannot spend the offer
        twice: the second finds no dispatched head left and is refused.
        """
        if action not in ("accepted", "declined"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"success": False, "error": "INVALID_ACTION"},
            )

        not_found = HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"success": False, "error": "OFFER_NOT_FOUND"},
        )

        assignment = await PublicShiftAssignment.get(assignment_id)
        if assignment is None or assignment.dispatch_status != "dispatched":
            # Already answered, never offered, or withdrawn — all the same answer.
            raise not_found
        caller_hash = await self._phone_hash_for(phone=phone, token=token)
        if not assignment.phone_hash or assignment.phone_hash != caller_hash:
            raise not_found
        if not assignment.response_code_hash or not hmac.compare_digest(
            assignment.response_code_hash, sha256_hex(normalize_response_code(code))
        ):
            raise not_found

        now = datetime.now(UTC)
        moved = (
            await accept_dispatched_slot(job_id=assignment.job_id, now=now)
            if action == "accepted"
            else await decline_dispatched_slot(job_id=assignment.job_id, now=now)
        )
        if not moved:
            # The counter holds no dispatched head for this job, so this offer has
            # already been spent — or was never counted, which staff must reconcile.
            logger.warning(
                "No dispatched slot to move for %s on %s", assignment_id, assignment.job_id
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"success": False, "error": "OFFER_ALREADY_ANSWERED"},
            )

        buffer = ShiftResponseBuffer(
            id=assignment_id,
            shelter_code=assignment.shelter_code,
            job_id=assignment.job_id,
            volunteer_id=assignment.volunteer_id,
            action=action,
            responded_at=now,
            synced_to_couch=False,
        )
        try:
            await buffer.insert()
        except DuplicateKeyError:
            # The id is the assignment id, so this is a second answer that slipped past
            # the checks above. Give the quota move back rather than leave it applied.
            if action == "accepted":
                await release_job_slot(job_id=assignment.job_id, now=now)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"success": False, "error": "OFFER_ALREADY_ANSWERED"},
            ) from None

        # Reflect it locally too. CouchDB is the system of record and the worker will
        # write there within seconds, but the volunteer is looking at this screen now.
        assignment.dispatch_status = action
        assignment.status = "standby" if action == "accepted" else "cancelled"
        assignment.response_code_hash = None
        assignment.updated_at = now
        await assignment.save()

        return DispatchRespondResponse(assignment_id=assignment_id, dispatch_status=action)

    async def cancel(self, token: str) -> VolunteerCancelResponse:
        """Withdraw an application. The applicant's own tracking token only.

        A phone-lookup reference is refused here even though it opens the same pass:
        anyone who knows the number can mint one, and a cancelled shift cannot be taken
        back by the volunteer. 404 rather than 403 — saying "that is the wrong kind of
        token" would confirm the ticket exists.
        """
        if is_view_token(token):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "TICKET_NOT_FOUND"},
            )
        token_hash = sha256_hex(token)
        buffer = await VolunteerApplicationBuffer.find_one(
            VolunteerApplicationBuffer.tracking_token_hash == token_hash
        )
        projected = await PublicJobApplication.find_one(
            PublicJobApplication.tracking_token_hash == token_hash
        )
        if buffer is None and projected is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"success": False, "error": "TICKET_NOT_FOUND"},
            )

        current = projected.status if projected is not None else buffer.status  # type: ignore[union-attr]
        if current not in _CANCELLABLE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"success": False, "error": "NOT_CANCELLABLE"},
            )

        now = datetime.now(UTC)
        job_id = projected.job_id if projected is not None else buffer.job_id  # type: ignore[union-attr]
        if current == "confirmed":
            await release_job_slot(job_id=job_id, now=now)

        if buffer is not None and not buffer.synced_to_couch:
            # Still ours to change — cancelling here means inbound writes a cancelled
            # application rather than creating one the shelter then has to withdraw.
            buffer.status = "cancelled"
            await buffer.save()
            return VolunteerCancelResponse()

        # Already in CouchDB. The BFF owns that write path; reflect it locally so the
        # pass stops showing a live ticket, and let the caller persist to the shelter.
        if projected is not None:
            projected.status = "cancelled"
            projected.updated_at = now
            await projected.save()
        if buffer is not None:
            buffer.status = "cancelled"
            await buffer.save()
        return VolunteerCancelResponse()


_use_case = VolunteersUseCase()


def get_volunteers_use_case() -> VolunteersUseCase:
    return _use_case
