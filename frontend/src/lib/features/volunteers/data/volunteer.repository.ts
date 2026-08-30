/**
 * Repository INTERFACES for the volunteers feature (00-foundation.md §00.3).
 *
 * Interfaces only — no implementation. Concrete adapters live in the
 * co-located `*.remote.ts` files (`createRemoteRepository(getShelterDb())`,
 * mirroring `frontend/CONTRIBUTING.md` §4.2 / `people.remote.ts` /
 * `operations.remote.ts`). The application layer (00.4, not built here)
 * depends on these interfaces, never on CouchDB directly.
 */

import type { AuthorContext } from '$lib/db/model';
import type {
	Volunteer,
	VolunteerInput,
	VolunteerStatus,
	VolunteerSource
} from '../domain/volunteer.schema';
import type { Job, JobInput, JobStatus, JobTier } from '../domain/job.schema';
import type {
	JobApplication,
	JobApplicationInput,
	JobApplicationStatus
} from '../domain/job-application.schema';
import type {
	ShiftAssignment,
	ShiftAssignmentInput,
	ShiftAssignmentStatus,
	ShiftKind,
	CheckInMethod
} from '../domain/shift-assignment.schema';
import type {
	VolunteerTransfer,
	VolunteerTransferInput,
	VolunteerTransferStatus
} from '../domain/volunteer-transfer.schema';

// ---------------------------------------------------------------------------
// Mango indexes required by schema.md §2.8 / §2.9 / §2.17 / §2.18 / §2.20 and
// 00-foundation.md §00.3.
//
// The codebase's established mechanism for declaring + provisioning shelter-DB
// Mango indexes is `REFERRAL_MANGO_INDEXES` (`$lib/server/shelter-access-design.ts`)
// deployed via `deployReferralMangoIndexes` (`$lib/server/shelters.admin.ts`,
// admin-credentialed, server-only). This data layer must not import
// `$lib/server/**` (read-only queries here must not require admin credentials),
// so the definitions below are declared in the same `{index:{fields:[...]}, name, type:'json'}`
// shape for whoever wires shelter-DB provisioning to pick up — they are pure
// data, no I/O. `type` is always the leading field (matches the `referral-*-idx`
// convention) so each index also serves plain `{selector:{type:...}}` scans.
//
// job            → (shelter_code, status)
// job_application→ (job_id, status) · (tracking_token) · (volunteer_id, status)
// shift_assignment→ (volunteer_id, date) · (date, shift) · (job_id, status) ·
//                   (duty_window.start_ts, duty_window.end_ts)
// volunteer      → (phone_hash) · (tracking_token) · (status)
// volunteer_transfer → (to_shelter_code, status) · (volunteer_id, status)
// ---------------------------------------------------------------------------
export const VOLUNTEER_MANGO_INDEXES = [
	{
		index: { fields: ['type', 'shelter_code', 'status'] },
		name: 'job-type-shelter-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'job_id', 'status'] },
		name: 'job-application-type-job-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'tracking_token'] },
		name: 'job-application-type-tracking-token-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'volunteer_id', 'status'] },
		name: 'job-application-type-volunteer-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'volunteer_id', 'date'] },
		name: 'shift-assignment-type-volunteer-date-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'date', 'shift'] },
		name: 'shift-assignment-type-date-shift-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'job_id', 'status'] },
		name: 'shift-assignment-type-job-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'duty_window.start_ts', 'duty_window.end_ts'] },
		name: 'shift-assignment-type-duty-window-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'phone_hash'] },
		name: 'volunteer-type-phone-hash-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'tracking_token'] },
		name: 'volunteer-type-tracking-token-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'status'] },
		name: 'volunteer-type-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'to_shelter_code', 'status'] },
		name: 'volunteer-transfer-type-to-shelter-status-idx',
		type: 'json' as const
	},
	{
		index: { fields: ['type', 'volunteer_id', 'status'] },
		name: 'volunteer-transfer-type-volunteer-status-idx',
		type: 'json' as const
	}
];

// ---------------------------------------------------------------------------
// volunteer
// ---------------------------------------------------------------------------

export type VolunteerFilter = {
	status?: VolunteerStatus;
	source?: VolunteerSource;
	checkedIn?: boolean;
	/** Free-text match against name/nickname/phone — filtered client-side. */
	search?: string;
};

export interface VolunteerRepository {
	list(filter?: VolunteerFilter): Promise<Volunteer[]>;
	get(id: string): Promise<Volunteer | null>;
	getByTrackingToken(token: string): Promise<Volunteer | null>;
	getByPhoneHash(phoneHash: string): Promise<Volunteer | null>;
	/**
	 * Mint a volunteer from form input + author context. `volunteer_code` is
	 * assigned here (`domain/volunteer-code.ts#nextVolunteerCode` over the
	 * shelter's existing codes) — callers never pass one in.
	 */
	create(
		input: VolunteerInput,
		ctx: AuthorContext,
		fields?: { status?: VolunteerStatus }
	): Promise<Volunteer>;
	/** Read-modify-write an edited volunteer (LWW: bumps `updated_at`). */
	update(volunteer: Volunteer): Promise<Volunteer>;
	/**
	 * Flip `checked_in` + `current_shelter_code` (Time-Bound Write Access gate,
	 * FR-VOL-05R). Read-modify-write against the latest `_rev`.
	 */
	setCheckedIn(id: string, checkedIn: boolean, shelterCode: string | null): Promise<Volunteer>;
}

// ---------------------------------------------------------------------------
// job
// ---------------------------------------------------------------------------

export type JobFilter = {
	status?: JobStatus;
	tier?: JobTier;
	isUrgent?: boolean;
};

export interface JobRepository {
	list(filter?: JobFilter): Promise<Job[]>;
	get(id: string): Promise<Job | null>;
	create(input: JobInput, ctx: AuthorContext): Promise<Job>;
	/**
	 * Read-modify-write metadata-only edits (title/description/quota template/
	 * status/etc). Callers must never hand-edit `slots_confirmed` /
	 * `slots_dispatched` / `slots_remaining` through this method — those move
	 * only through the quota-transition methods below, which retry on 409 and
	 * assert `assertQuotaInvariant` before every `put`.
	 */
	update(job: Job): Promise<Job>;
	/**
	 * SM dispatches `count` volunteer(s): `slots_remaining -1, slots_dispatched
	 * +1` (per unit) via `domain/quota.ts#applyDispatch`. Read-modify-write with
	 * retry on CouchDB 409.
	 */
	dispatch(jobId: string, count?: number): Promise<Job>;
	/** Dispatched offer accepted: `slots_dispatched -1, slots_confirmed +1` (`applyAccept`). */
	acceptDispatch(jobId: string, count?: number): Promise<Job>;
	/** Dispatched offer declined: `slots_dispatched -1, slots_remaining +1` (`applyDecline`). */
	declineDispatch(jobId: string, count?: number): Promise<Job>;
	/**
	 * Direct `slots_remaining -1, slots_confirmed +1` — the job-board
	 * self-service path (an application that resolves straight to `confirmed`,
	 * CR-094 FR-VOL-10.3, never passed through an SM dispatch offer). Composed
	 * from `applyDispatch` + `applyAccept` (both pure `domain/quota.ts`
	 * transitions) so no new domain logic is introduced here.
	 */
	confirmSlot(jobId: string, count?: number): Promise<Job>;
	/**
	 * Direct `slots_confirmed -1, slots_remaining +1` (`applyRelease`) — the
	 * inverse of {@link confirmSlot}. Backs
	 * `ShiftAssignmentRepository#unassign`: an SM removing a volunteer who was
	 * outright-assigned (never went through an offer, so nothing sits in
	 * `slots_dispatched` for them) gives the seat straight back to `open`.
	 */
	releaseSlot(jobId: string, count?: number): Promise<Job>;
}

// ---------------------------------------------------------------------------
// job_application
// ---------------------------------------------------------------------------

export type JobApplicationFilter = {
	jobId?: string;
	status?: JobApplicationStatus;
	volunteerId?: string;
};

export interface JobApplicationRepository {
	list(filter?: JobApplicationFilter): Promise<JobApplication[]>;
	get(id: string): Promise<JobApplication | null>;
	getByTrackingToken(token: string): Promise<JobApplication | null>;
	/**
	 * Mint a `job_application`. Initial status is decided here via
	 * `domain/skills.ts#initialStatusForSkills` — controlled skills always land
	 * on `pending_review` regardless of `job.auto_accept`; otherwise
	 * `confirmed` only when the job has `auto_accept === true`, and
	 * `pending_review` otherwise (schema.md §2.18 default). A `confirmed`
	 * outcome atomically consumes one job slot (`JobRepository#confirmSlot`) in
	 * the same call, so the application doc and `job.slots_*` never disagree.
	 */
	create(
		input: JobApplicationInput,
		ctx: AuthorContext,
		options?: { controlledSkills?: readonly string[] }
	): Promise<JobApplication>;
	/**
	 * SM reviews a `pending_review` application. `confirmed` consumes one job
	 * slot (`JobRepository#confirmSlot`, retried on 409) before the application
	 * doc is saved; `rejected` only updates the application (a pending
	 * application never held a slot — schema.md §2.17 migration note).
	 */
	review(
		id: string,
		decision: Extract<JobApplicationStatus, 'confirmed' | 'rejected'>,
		actor: string,
		notes?: string | null
	): Promise<JobApplication>;
	/** Applicant/staff withdraws a still-`pending_review` application. */
	cancel(id: string, actor: string): Promise<JobApplication>;
}

// ---------------------------------------------------------------------------
// shift_assignment
// ---------------------------------------------------------------------------

export type ShiftAssignmentFilter = {
	volunteerId?: string;
	jobId?: string;
	date?: string;
	shift?: ShiftKind;
	status?: ShiftAssignmentStatus;
	/**
	 * Client-side refinement after the indexed `date`/`job_id`/`volunteer_id`
	 * fetch (the in-memory + Mango `find()` primitive only matches equality —
	 * see `$lib/db/in-memory-repository.ts`). Inclusive bounds, ISO timestamps.
	 */
	dutyWindowStart?: string;
	dutyWindowEnd?: string;
};

export interface ShiftAssignmentRepository {
	list(filter?: ShiftAssignmentFilter): Promise<ShiftAssignment[]>;
	get(id: string): Promise<ShiftAssignment | null>;
	/**
	 * SM dispatches a volunteer to a job: creates the `shift_assignment`
	 * (`status: 'assigned'` or `'standby'` for `flex`, `dispatch_status:
	 * 'dispatched'`) and calls `JobRepository#dispatch` in the same call.
	 */
	dispatch(input: ShiftAssignmentInput, ctx: AuthorContext): Promise<ShiftAssignment>;
	/**
	 * SM assigns a volunteer outright — no offer, no waiting for the volunteer
	 * to accept (owner decision 2026-08-29). The `shift_assignment` is minted
	 * already `dispatch_status: 'accepted'` and the slot goes straight from
	 * `slots_remaining` to `slots_confirmed` (`JobRepository#confirmSlot`), so
	 * the quota never parks in `slots_dispatched`.
	 *
	 * Distinct from `dispatch()`, which is kept for the offer/accept flow the
	 * volunteer-facing side still uses.
	 */
	assign(input: ShiftAssignmentInput, ctx: AuthorContext): Promise<ShiftAssignment>;
	/** Volunteer accepts the offer: `dispatch_status → accepted` + `JobRepository#acceptDispatch`. */
	acceptDispatch(id: string): Promise<ShiftAssignment>;
	/** Volunteer declines: `dispatch_status → declined`, `status → cancelled` + `JobRepository#declineDispatch`. */
	declineDispatch(id: string): Promise<ShiftAssignment>;
	/**
	 * Record check-in (`status → checked_in`). `method` defaults to `qr`;
	 * `manual_override` requires `reason` (schema.md §2.9 refine).
	 */
	checkIn(
		id: string,
		actor: string,
		method?: CheckInMethod,
		reason?: string | null
	): Promise<ShiftAssignment>;
	/** Record check-out (`status → completed`). */
	checkOut(id: string): Promise<ShiftAssignment>;
	/**
	 * SM removes a volunteer from a shift before they've worked it — the
	 * "ลบออกจากกะ" affordance on the job detail shifts tab.
	 *
	 * Refuses `checked_in`/`completed` (use check-out instead; erasing a
	 * worked shift destroys attendance history) and an already
	 * `cancelled`/`no_show` row (nothing to undo). For a `standby`/`assigned`
	 * row: an outstanding offer (`dispatch_status: 'dispatched'`) is removed
	 * via the existing {@link declineDispatch} transition (`slots_dispatched
	 * -1, slots_remaining +1`); an outright assignment (`dispatch_status:
	 * 'accepted'`, the roster page's only write path) releases a CONFIRMED
	 * slot instead (`JobRepository#releaseSlot`, `slots_confirmed -1,
	 * slots_remaining +1`) — picking the wrong one would either under- or
	 * over-credit the job's quota.
	 */
	unassign(id: string): Promise<ShiftAssignment>;
}

// ---------------------------------------------------------------------------
// volunteer_transfer
// ---------------------------------------------------------------------------

export type VolunteerTransferFilter = {
	toShelterCode?: string;
	volunteerId?: string;
	status?: VolunteerTransferStatus;
};

export interface VolunteerTransferRepository {
	list(filter?: VolunteerTransferFilter): Promise<VolunteerTransfer[]>;
	get(id: string): Promise<VolunteerTransfer | null>;
	request(input: VolunteerTransferInput, ctx: AuthorContext): Promise<VolunteerTransfer>;
	/**
	 * Accept/reject a pending transfer request.
	 *
	 * TODO(D-VOL-TRANSFER-APPROVE): CR-094 §7 leaves open whether this doc
	 * lives in the origin or destination shelter DB, and whose DB is
	 * authoritative for the approval write. This adapter only writes the
	 * `volunteer_transfer` doc itself in the *active* shelter DB
	 * (`getShelterDb()`) — it deliberately does NOT update
	 * `volunteer.current_shelter_code` (§2.8) or revoke the origin shelter's
	 * role grant (FR-VOL-12.3), because both of those may require a
	 * cross-shelter-DB write that this decision has not resolved. Do not add
	 * that cross-DB logic here until CR-094 §7 is closed.
	 */
	decide(
		id: string,
		decision: Extract<VolunteerTransferStatus, 'accepted' | 'rejected'>,
		actor: string
	): Promise<VolunteerTransfer>;
	/** Requester cancels their own still-`pending` request. */
	cancel(id: string, actor: string): Promise<VolunteerTransfer>;
}
