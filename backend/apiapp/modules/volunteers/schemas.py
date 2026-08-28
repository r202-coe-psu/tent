"""Public volunteer job board + Digital Pass schemas (CR-092)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class JobShiftTemplate(BaseModel):
    shift_name: str = ""
    start_time: str = ""
    end_time: str = ""
    days: list[str] = Field(default_factory=list)


class PublicJobItem(BaseModel):
    """One card on the board (CR-092 screen 1).

    Carries the 2-colour quota the card renders (``รับแล้ว`` / ``ว่าง``) — the third,
    ``dispatched``, is a back-office state and is folded into "not available" here
    rather than shown to the public.
    """

    job_id: str
    shelter_code: str
    shelter_name: str = ""
    title: str
    description: str
    tier: str
    skills_required: list[str] = Field(default_factory=list)
    shift_template: JobShiftTemplate = Field(default_factory=JobShiftTemplate)
    quota: int
    slots_confirmed: int
    slots_remaining: int
    status: str
    #: True when applying will land in ``pending_review`` rather than issue a confirmed
    #: ticket, so the form can say so before the applicant commits.
    requires_review: bool = False


class PublicJobListResponse(BaseModel):
    success: bool = True
    jobs: list[PublicJobItem] = Field(default_factory=list)


class VolunteerApplyRequest(BaseModel):
    """The 4-field quick-apply form (FR-VOL-02.2).

    ``national_id`` is optional here even though CR-092 lists it as a main field: a
    volunteer with a passport or a pink card has no 13-digit number, and refusing them
    at the form would be a worse failure than a profile that dedupes on phone alone.
    """

    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=6, max_length=30)
    national_id: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=200)
    skills: list[str] = Field(default_factory=list)
    shift_date: str | None = None
    station: str | None = None


class VolunteerApplyResponse(BaseModel):
    success: bool = True
    tracking_token: str
    status: str
    job_id: str


class TicketShift(BaseModel):
    date: str = ""
    start_time: str = ""
    end_time: str = ""
    station: str | None = None


class VolunteerTicket(BaseModel):
    """What the Digital Pass may show.

    No ``national_id`` in any form and no raw phone — FR-VOL-03.4. ``token`` is echoed
    because the pass displays it as the human-readable ticket id.
    """

    token: str
    #: False when the pass was opened through a phone lookup rather than the applicant's
    #: own ticket token. Cancelling is irreversible, so it stays behind the token that
    #: only the applicant holds — the UI hides the button and the API refuses it.
    can_cancel: bool = True
    status: str
    job_id: str
    job_title: str = ""
    shelter_code: str
    shelter_name: str = ""
    applicant_name: str
    phone_masked: str
    skills: list[str] = Field(default_factory=list)
    selected_shift: TicketShift = Field(default_factory=TicketShift)
    applied_at: str
    #: What the QR encodes — the pass URL, so a check-in scanner reads a token it can
    #: resolve without the applicant needing an account.
    qr_payload: str


class VolunteerTicketResponse(BaseModel):
    success: bool = True
    ticket: VolunteerTicket


class TicketFindRequest(BaseModel):
    """Tab 2 — "ค้นหาตั๋วของฉัน" by the phone the application was made with."""

    phone: str = Field(min_length=6, max_length=30)


class TicketFindItem(BaseModel):
    #: A read-only, expiring reference — not the applicant's tracking token. Anyone who
    #: knows the phone number can reach this list, so what it hands out must not be able
    #: to cancel a shift.
    view_token: str
    status: str
    job_title: str = ""
    shelter_code: str
    shift_date: str = ""


class TicketFindResponse(BaseModel):
    success: bool = True
    tickets: list[TicketFindItem] = Field(default_factory=list)


class VolunteerCancelResponse(BaseModel):
    success: bool = True
    message: str = "Application cancelled"


class ScheduleShift(BaseModel):
    """One shift the volunteer is actually on (schema.md §2.9, CR-092 หน้าจอ 6).

    Distinct from a ticket: a ticket is the application they filed, this is the roster
    entry a manager put them on, with the duty window the Time-Bound access guard reads
    and the check-in stamps the tablet station writes.
    """

    assignment_id: str
    job_id: str
    job_title: str = ""
    shelter_code: str
    shelter_name: str = ""
    date: str = ""
    shift: str = ""
    station: str = ""
    start_ts: str | None = None
    end_ts: str | None = None
    check_in_at: str | None = None
    check_out_at: str | None = None
    status: str
    #: dispatched | accepted | declined | null — drives the Dispatch Card's two buttons.
    dispatch_status: str | None = None


class VolunteerScheduleResponse(BaseModel):
    success: bool = True
    shifts: list[ScheduleShift] = Field(default_factory=list)


class ScheduleLookupRequest(BaseModel):
    """Same key as the ticket lookup — the portal signs in by phone."""

    phone: str = Field(min_length=6, max_length=30)


class DispatchRespondRequest(BaseModel):
    """Answering an offered shift — two factors, neither enough alone.

    ``phone`` is what the portal signed in with and must match the assignment;
    ``code`` is the short code a manager read out. A six-character code is only safe
    because the caller has to know whose shift it is as well.
    """

    assignment_id: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=6, max_length=30)
    code: str = Field(min_length=4, max_length=20)
    action: Literal["accepted", "declined"]


class DispatchRespondResponse(BaseModel):
    success: bool = True
    assignment_id: str
    dispatch_status: str
