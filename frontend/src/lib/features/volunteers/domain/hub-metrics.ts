/**
 * hub-metrics.ts — Smart Volunteer Control Hub counters (CR-094 FR-VOL-08.2,
 * plus the binding owner decision in `docs/plans/volunteer-backoffice/
 * 00-foundation.md` appendix "มติเพิ่มเติม 2026-08-26").
 *
 * "ทุกค่าคำนวณจากฟังก์ชัน domain ชุดเดียว (single source of truth) ห้ามคำนวณซ้ำใน
 * UI แต่ละแท็บ" — `computeHubMetrics` is the ONLY function allowed to produce
 * the Control Hub numbers. Every tab (Job Board, Roster & Attendance,
 * Approvals) must call this, never recompute inline (AC-094-09).
 *
 * Binding rules (owner decision, 2026-08-26):
 *   - Shift state comes from `shift_assignment.status` ONLY — never
 *     `volunteer.checked_in` (a denormalised cache that can skew; the review
 *     that raised this reproduced a case where a volunteer vanished from all
 *     5 counters because the cache disagreed with the assignment doc).
 *   - Every counter that involves shifts is scoped to **today** (the
 *     caller-supplied `today` reference date — this function stays pure and
 *     never calls `new Date()` itself) and counted as **distinct
 *     volunteers**, not rows (one volunteer can hold >1 assignment on a day).
 *
 * Field → Thai label:
 *   ready           พร้อมปฏิบัติงาน   — distinct `status: 'active'` volunteers
 *                                      (a pool — deliberately overlaps the
 *                                      other counters)
 *   assigned        รับกะแล้ว         — distinct volunteers with a TODAY
 *                                      assignment in `assigned`/`standby`
 *   checkedInNow    เช็คอินอยู่ตอนนี้ — distinct volunteers with a TODAY
 *                                      assignment in `checked_in`
 *   completed       เสร็จสิ้นภารกิจ    — distinct volunteers with a TODAY
 *                                      assignment in `completed`
 *                                      (FR-VOL-11.3 attendance bar — kept
 *                                      here so the roster tab never
 *                                      recomputes it inline, FR-VOL-08.2)
 *   pendingApproval รออนุมัติ         — job_applications awaiting review
 *   pendingIdentity รอยืนยันตัวตน     — `status: 'active'` volunteers not yet
 *                                      `identity_verified` (excludes
 *                                      `inactive` volunteers)
 */

import type { Volunteer } from './volunteer.schema';
import type { ShiftAssignment, ShiftAssignmentStatus } from './shift-assignment.schema';
import type { JobApplication } from './job-application.schema';

export interface HubMetricsInput {
	volunteers: readonly Pick<Volunteer, 'status' | 'identity_verified'>[];
	/** Only `shift_assignment.status` is read for the shift-based counters — never `volunteer.checked_in`. */
	assignments: readonly Pick<ShiftAssignment, 'volunteer_id' | 'date' | 'status'>[];
	applications: readonly Pick<JobApplication, 'status'>[];
	/** Calendar date (`YYYY-MM-DD`) "today" is evaluated against — supplied by the caller; never computed here. */
	today: string;
}

export interface HubMetrics {
	ready: number;
	assigned: number;
	checkedInNow: number;
	completed: number;
	pendingApproval: number;
	pendingIdentity: number;
}

/**
 * Statuses that count as "has a shift today, not checked in" (assigned or
 * standby) — exported so UI filters (e.g. the roster attendance tab's
 * click-to-filter tiles) can match the same grouping instead of re-deriving it.
 */
export const ASSIGNED_STATUSES: ReadonlySet<ShiftAssignmentStatus> = new Set([
	'assigned',
	'standby'
]);

/** Count of distinct `volunteer_id`s among today's assignments whose status is in `statuses`. */
function distinctVolunteersToday(
	assignments: HubMetricsInput['assignments'],
	today: string,
	statuses: ReadonlySet<string>
): number {
	const ids = new Set<string>();
	for (const a of assignments) {
		if (a.date === today && statuses.has(a.status)) ids.add(a.volunteer_id);
	}
	return ids.size;
}

export function computeHubMetrics(input: HubMetricsInput): HubMetrics {
	const volunteers = input.volunteers ?? [];
	const assignments = input.assignments ?? [];
	const applications = input.applications ?? [];
	const today = input.today;
	// Guard the `undefined === undefined` hole: a missing `today` would other-
	// wise match assignments whose `date` is also missing and report them as
	// today's roster.
	if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
		throw new TypeError(`computeHubMetrics requires today as YYYY-MM-DD, got ${String(today)}`);
	}

	return {
		ready: volunteers.filter((v) => v.status === 'active').length,
		assigned: distinctVolunteersToday(assignments, today, ASSIGNED_STATUSES),
		checkedInNow: distinctVolunteersToday(assignments, today, new Set(['checked_in'])),
		completed: distinctVolunteersToday(assignments, today, new Set(['completed'])),
		pendingApproval: applications.filter((a) => a.status === 'pending_review').length,
		pendingIdentity: volunteers.filter((v) => v.status === 'active' && !v.identity_verified).length
	};
}
