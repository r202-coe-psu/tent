"""Public volunteer job board + Digital Pass schemas (CR-092)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class JobShiftTemplate(BaseModel):
    shift_name: str = ""
    start_time: str = ""
    end_time: str = ""
    days: list[str] = Field(default_factory=list)


class PublicJobShift(BaseModel):
    """Concrete shift identity plus renderable snapshot fields."""

    shift_id: str
    date: str = ""
    end_date: str | None = None
    start_time: str = ""
    end_time: str = ""
    station: str | None = None
    quota: int = 0
    slots_confirmed: int = 0
    slots_dispatched: int = 0
    slots_remaining: int = 0
    applicants_count: int = 0


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
    shifts: list[PublicJobShift] = Field(default_factory=list)
    quota: int
    slots_confirmed: int
    slots_remaining: int
    applicants_count: int = 0
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
    # Canonical concrete shift identity. Optional only during the BFF compatibility
    # window; jobs that expose concrete shifts require it at the use-case boundary.
    shift_id: str | None = None
    shift_date: str | None = None
    station: str | None = None


class VolunteerApplyResponse(BaseModel):
    success: bool = True
    tracking_token: str
    status: str
    job_id: str
    shift_id: str | None = None


class TicketShift(BaseModel):
    shift_id: str | None = None
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
    shift_id: str | None = None
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


class PortalCredential(BaseModel):
    """How a caller identifies the volunteer whose data it is asking for.

    Exactly one of the two, and they are equally powerful because both resolve to the
    same ``phone_hash``: the phone the application was made with, or a ticket token —
    the applicant's own ``TKT-VOL-…`` or a read-only ``VIEW-…`` minted by a phone
    lookup. CR-092 หน้าจอ 6 lists both as sign-in routes for a volunteer who has no
    account, so refusing one of them here would leave the QR on their pass unusable.

    Neither is a secret a stranger cannot reach — a phone number is guessable and a
    ``VIEW-`` token is handed out to anyone who knows one — which is why every route
    that takes this is rate limited and why answering a dispatched shift still needs
    the separate code a manager reads out.

    "Exactly one" is enforced in the use case rather than by a validator here, so the
    refusal comes back in this module's own ``{"success": false, "error": …}`` envelope
    like every other refusal, instead of FastAPI's field-error shape.
    """

    phone: str | None = Field(default=None, min_length=6, max_length=30)
    token: str | None = Field(default=None, min_length=6, max_length=200)
    #: Opaque public reference from the resolved profile. It binds a URL session to the
    #: public volunteer record without putting a phone number in the URL.
    portal_id: str | None = Field(default=None, min_length=1, max_length=120)


class TicketFindRequest(PortalCredential):
    """Tab 2 — "ค้นหาตั๋วของฉัน", by phone or by a token already in hand."""


class TicketFindItem(BaseModel):
    #: A read-only, expiring reference — not the applicant's tracking token. Anyone who
    #: knows the phone number can reach this list, so what it hands out must not be able
    #: to cancel a shift.
    view_token: str
    #: The name on the application, so the portal can greet the person who signed in
    #: rather than invent one. Already shown on the pass this reference opens, so it
    #: exposes nothing the same caller could not already read.
    applicant_name: str = ""
    status: str
    job_title: str = ""
    shelter_code: str
    shift_date: str = ""
    shift_id: str | None = None


class TicketFindResponse(BaseModel):
    success: bool = True
    tickets: list[TicketFindItem] = Field(default_factory=list)
    #: The number the tickets belong to, masked (FR-VOL-03.4). The portal shows it as
    #: "signed in as", which it cannot do on a token sign-in without being told — and
    #: masked is what may be shown on a screen the volunteer holds up in public.
    phone_masked: str = ""


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
    shift_id: str | None = None
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


class ScheduleLookupRequest(PortalCredential):
    """Same key as the ticket lookup — the portal signs in by phone or by token."""


class DispatchRespondRequest(PortalCredential):
    """Answering an offered shift — two factors, neither enough alone.

    The credential is whatever the portal signed in with and must resolve to the
    assignment's own volunteer; ``code`` is the short code a manager read out. A
    six-character code is only safe because the caller has to know whose shift it is
    as well.
    """

    assignment_id: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=4, max_length=20)
    action: Literal["accepted", "declined"]


class DispatchRespondResponse(BaseModel):
    success: bool = True
    assignment_id: str
    dispatch_status: str


class VolunteerProfile(BaseModel):
    """The volunteer's own profile, merged across every shelter they hold one at.

    ``volunteer`` is a per-shelter document, so someone who has helped at two centres has
    two of them. The portal shows one person, so the newest document supplies the
    identity and the shelters are listed alongside — and an edit made here is applied to
    all of them (see ``VolunteerProfileUpdateBuffer``).

    No ``national_id`` and no raw phone, same rule as the Digital Pass (FR-VOL-03.4).
    """

    first_name: str = ""
    last_name: str = ""
    nickname: str | None = None
    phone_masked: str = ""
    email: str | None = None
    volunteer_code: str = ""
    skills: list[str] = Field(default_factory=list)
    organization: str | None = None
    #: Staff decision — the portal renders it read-only.
    identity_verified: bool = False
    personnel_type: str = "volunteer"
    #: Every shelter the person holds a profile at, newest first.
    shelter_codes: list[str] = Field(default_factory=list)
    #: Opaque public reference used by the volunteer portal URL.
    portal_id: str = ""


class VolunteerProfileResponse(BaseModel):
    success: bool = True
    #: ``None`` when the credential resolves to nobody — the same answer an unknown phone
    #: number gets everywhere else on this router, so this cannot be used as a probe.
    profile: VolunteerProfile | None = None


class VolunteerProfileUpdateRequest(PortalCredential):
    """What a volunteer may change about themselves.

    Skills only, for now. They are self-declared and carry no authority on their own: a
    controlled job still routes to review, and ``identity_verified`` stays a staff badge
    — so this cannot be used to unlock work the shelter has not approved.
    """

    skills: list[str] = Field(default_factory=list, max_length=30)


class VolunteerProfileUpdateResponse(BaseModel):
    success: bool = True
    #: How many `volunteer` documents the edit was queued against.
    updated: int = 0
    profile: VolunteerProfile | None = None
