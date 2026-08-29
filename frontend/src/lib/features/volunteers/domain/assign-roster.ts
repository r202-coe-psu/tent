/**
 * assign-roster.ts — the candidate list behind "มอบหมายอาสาเข้ากะ" (CR-094
 * FR-VOL-09, approved mockup 2026-08-28).
 *
 * Pure TypeScript — no I/O, no Svelte. Given one target sub-shift and the
 * shelter's volunteers + shift_assignments, it decides for every volunteer
 * which of the four row states the screen must render, and applies the three
 * filter groups + search. The dialog itself therefore performs NO eligibility
 * or collision maths of its own (the same rule AC-094-09 puts on the hub
 * counters).
 *
 * ⚠️ Which assignment belongs to WHICH sub-shift is matched by
 * `job_id + date + identical duty_window`, because `shift_assignment` still
 * carries no `job_shift_id` (the same known gap `capacity.ts` documents).
 * Two sub-shifts of one job on the same day at the same hours would be
 * indistinguishable — but `shift-batch.ts#isDuplicateShift` already forbids
 * creating that pair, so the ambiguity cannot arise through the UI.
 */

import { findTimeCollision } from './collision';
import { resolveDutyWindow, shiftDutyWindow } from './duty-window';
import type { DutyWindow, ShiftAssignment, ShiftKind } from './shift-assignment.schema';
import type { Job, JobShift } from './job.schema';
import type { Volunteer } from './volunteer.schema';
import { isControlledSkill } from './skills';

// ---------------------------------------------------------------------------
// Row state
// ---------------------------------------------------------------------------

/**
 * What the badge on the right of a candidate row says.
 *
 * - `accepted`    ✓ ยืนยันเข้าร่วมกะนี้แล้ว (Approved)
 * - `dispatched`  ⏱ มอบหมายในกะนี้แล้ว (รออาสาตอบรับ)
 * - `collision`   ⚠️ เวลาชนกับกะอื่น — names the clashing shift
 * - `available`   ● ว่างในกะนี้ (พร้อมปฏิบัติงาน)
 */
export type AssignRowState =
	| { kind: 'accepted' }
	| { kind: 'dispatched' }
	| {
			kind: 'collision';
			/** Title of the job whose shift clashes, for the badge text. */
			jobTitle: string;
			/** Bangkok wall-clock `HH:mm` of the clashing window. */
			startTime: string;
			endTime: string;
	  }
	| { kind: 'available' };

export interface AssignCandidate {
	volunteer: Volunteer;
	state: AssignRowState;
	/** Carries at least one of the job's `skills_required` (always true when the job asks for none). */
	skillMatch: boolean;
	/** Carries a controlled skill — the "ทักษะวิชาชีพ/เจ้าหน้าที่" filter. */
	professional: boolean;
	/** Only `available` rows may be selected and dispatched. */
	assignable: boolean;
}

/** Statuses that mean the volunteer no longer holds the slot on THIS shift. */
const RELEASED_STATUSES: ReadonlySet<ShiftAssignment['status']> = new Set(['cancelled', 'no_show']);

/**
 * `true` when the offer on this shift has been taken up — accepted outright,
 * or already worked (checked in / completed, which can only follow an accept).
 */
function isAccepted(assignment: ShiftAssignment): boolean {
	return (
		assignment.dispatch_status === 'accepted' ||
		assignment.status === 'checked_in' ||
		assignment.status === 'completed'
	);
}

function sameWindow(a: DutyWindow, b: DutyWindow): boolean {
	return a.start_ts === b.start_ts && a.end_ts === b.end_ts;
}

/** Bangkok wall-clock `HH:mm`–`HH:mm` label for a clashing assignment's shift. */
function windowLabel(shift: JobShift | undefined): { startTime: string; endTime: string } {
	return shift
		? { startTime: shift.start_time, endTime: shift.end_time }
		: { startTime: '--:--', endTime: '--:--' };
}

// ---------------------------------------------------------------------------
// Building the roster
// ---------------------------------------------------------------------------

export interface AssignRosterInput {
	job: Pick<Job, '_id' | 'skills_required'>;
	shift: JobShift;
	volunteers: readonly Volunteer[];
	/** Every shift_assignment in scope — filtered to the shift's dates by the caller's query. */
	assignments: readonly ShiftAssignment[];
	/** All jobs, so a clashing assignment can be named. Keyed lookup, not a fetch. */
	jobsById: ReadonlyMap<string, Pick<Job, 'title' | 'shifts'>>;
	/** Skill keys that require certificate review; defaults to `skills.ts`'s list. */
	controlledSkills?: readonly string[];
}

/**
 * One {@link AssignCandidate} per volunteer, in the order given.
 *
 * Throws `DutyWindowError` (via `shiftDutyWindow`) if the target shift's
 * date/times are malformed — a window that cannot be computed must not
 * silently render every volunteer as "available", which is exactly the
 * fail-open that `collision.ts` guards against.
 */
export function buildAssignRoster(input: AssignRosterInput): AssignCandidate[] {
	const { job, shift, volunteers, assignments, jobsById, controlledSkills } = input;
	const targetWindow = shiftDutyWindow(shift);

	// Index once — this runs on every keystroke in the search box.
	const byVolunteer = new Map<string, ShiftAssignment[]>();
	for (const a of assignments) {
		if (RELEASED_STATUSES.has(a.status)) continue;
		const bucket = byVolunteer.get(a.volunteer_id);
		if (bucket) bucket.push(a);
		else byVolunteer.set(a.volunteer_id, [a]);
	}

	return volunteers.map((volunteer) => {
		const held = byVolunteer.get(volunteer._id) ?? [];
		const onThisShift = held.find(
			(a) => a.job_id === job._id && sameWindow(a.duty_window, targetWindow)
		);

		let state: AssignRowState;
		if (onThisShift) {
			state = isAccepted(onThisShift) ? { kind: 'accepted' } : { kind: 'dispatched' };
		} else {
			const clash = findTimeCollision(targetWindow, held);
			if (clash) {
				const clashJob = jobsById.get(clash.job_id);
				const clashShift = clashJob?.shifts.find((s) => {
					try {
						return sameWindow(shiftDutyWindow(s), clash.duty_window);
					} catch {
						// A malformed stored shift must not break the whole roster.
						return false;
					}
				});
				state = {
					kind: 'collision',
					jobTitle: clashJob?.title ?? 'ภารกิจอื่น',
					...windowLabel(clashShift)
				};
			} else {
				state = { kind: 'available' };
			}
		}

		// `skills_required` is optional on the stored doc (schema.md §2.17) — an
		// absent list means "no skill required", which matches everyone.
		const required = job.skills_required ?? [];
		return {
			volunteer,
			state,
			skillMatch: required.length === 0 || required.some((s) => volunteer.skills.includes(s)),
			professional: volunteer.skills.some((s) => isControlledSkill(s, controlledSkills)),
			assignable: state.kind === 'available'
		};
	});
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** ตัวกรองความตรงของทักษะ */
export type SkillFilter = 'all' | 'match';
/** ตัวกรองความพร้อมในกะ */
export type AvailabilityFilter = 'all' | 'ready' | 'no_collision';
/** ตัวกรองสิทธิ์/การยืนยันตัวตน */
export type EligibilityFilter = 'all' | 'verified' | 'professional';

export interface AssignRosterFilters {
	search?: string;
	skill?: SkillFilter;
	availability?: AvailabilityFilter;
	eligibility?: EligibilityFilter;
}

/** Name / nickname / phone / volunteer code — the search box's placeholder promise. */
function matchesSearch(candidate: AssignCandidate, needle: string): boolean {
	const v = candidate.volunteer;
	return [`${v.first_name} ${v.last_name}`, v.nickname, v.phone, v.volunteer_code].some(
		(field) => typeof field === 'string' && field.toLowerCase().includes(needle)
	);
}

export function filterAssignRoster(
	candidates: readonly AssignCandidate[],
	filters: AssignRosterFilters = {}
): AssignCandidate[] {
	const { search = '', skill = 'all', availability = 'all', eligibility = 'all' } = filters;
	const needle = search.trim().toLowerCase();

	return candidates.filter((c) => {
		if (needle && !matchesSearch(c, needle)) return false;
		if (skill === 'match' && !c.skillMatch) return false;
		// "พร้อมปฏิบัติงาน" = free for this shift; "เวลาไม่ชนกะ" is the weaker
		// test — it keeps volunteers already assigned to THIS shift, hiding only
		// the ones whose time clashes elsewhere.
		if (availability === 'ready' && c.state.kind !== 'available') return false;
		if (availability === 'no_collision' && c.state.kind === 'collision') return false;
		if (eligibility === 'verified' && !c.volunteer.identity_verified) return false;
		if (eligibility === 'professional' && !c.professional) return false;
		return true;
	});
}

/** How many of the visible rows can actually be dispatched (drives the select-all label). */
export function countAssignable(candidates: readonly AssignCandidate[]): number {
	return candidates.reduce((n, c) => n + (c.assignable ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------
// Dispatch input
// ---------------------------------------------------------------------------

/**
 * Which `shift_assignment.shift` kind a sub-shift dispatches as.
 *
 * The job form lets an SM pick any start/end, so most sub-shifts are `custom`;
 * the three 8h templates are recognised by comparing the resulting UTC window,
 * not the raw strings, so an equivalent span written a different way (a
 * 16:00–00:00 shift stored with tomorrow's `end_date`) still lands on
 * `afternoon`. Keeping this here means the dispatch call and the roster read
 * the same window arithmetic.
 */
export function shiftKindFor(shift: JobShift): ShiftKind {
	const window = shiftDutyWindow(shift);
	for (const kind of ['morning', 'afternoon', 'night'] as const) {
		const template = resolveDutyWindow(shift.date, kind);
		if (template && sameWindow(template, window)) return kind;
	}
	return 'custom';
}
