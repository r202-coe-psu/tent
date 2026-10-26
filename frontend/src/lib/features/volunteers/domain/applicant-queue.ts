/**
 * applicant-queue.ts — ordering rules for the job detail "ผู้สมัคร (Applicants
 * & Queue)" tab (01-tab-job-board.md §01.5).
 *
 * Pure TypeScript — no I/O, no Svelte. Lives in `domain/` rather than inside
 * the tab component because the queue order IS a business rule: an approval
 * queue that reorders itself between renders lets a manager approve a
 * different applicant from the one they aimed at.
 */

import type { JobApplication, JobApplicationStatus } from './job-application.schema';

export interface ApplicantQueue {
	/** `pending_review` only, oldest first — first come, first served. */
	pending: JobApplication[];
	/** Everything already decided (`confirmed`/`rejected`/`cancelled`), newest decision first. */
	reviewed: JobApplication[];
}

/**
 * `reviewed_at` is optional on the schema and is `null` on documents written
 * before CR-094, and `cancelled` applications are never reviewed at all — so
 * the sort falls back to `updated_at`, which every document has.
 */
function decidedAt(application: JobApplication): string {
	return application.reviewed_at ?? application.updated_at;
}

/**
 * Split one job's applications into the two lists the tab renders.
 *
 * Filtering by `jobId` happens here rather than in the query so the tab can
 * share the unfiltered `useJobApplications()` cache entry with the tab badge —
 * the two can then never show different numbers.
 *
 * Both lists are new arrays; the input is never mutated (it is TanStack Query
 * cache data, which must be treated as immutable).
 */
export function partitionApplicantQueue(
	applications: readonly JobApplication[],
	jobId: string
): ApplicantQueue {
	const mine = applications.filter((a) => a.job_id === jobId);
	return {
		pending: mine
			.filter((a) => a.status === 'pending_review')
			.sort((a, b) => a.created_at.localeCompare(b.created_at)),
		reviewed: mine
			.filter((a) => a.status !== 'pending_review')
			.sort((a, b) => decidedAt(b).localeCompare(decidedAt(a)))
	};
}

/** One applicant's pending applications for one job — one card in the queue (#716). */
export interface ApplicantGroup {
	/** `volunteer_id` when linked, else the applicant's phone hash. */
	key: string;
	/** That applicant's applications, one per shift, in date-then-time order. */
	applications: JobApplication[];
}

function applicantKey(application: JobApplication): string {
	return application.volunteer_id ?? `phone:${application.applicant.phone_hash}`;
}

function shiftOrder(application: JobApplication): string {
	const { date, start_time } = application.selected_shift;
	return `${date} ${start_time}`;
}

/**
 * Group applications by applicant, so one person who applied for several shifts of a job is
 * one card with every shift on it (#716).
 *
 * Groups keep the order of the input's first application per person — feed it
 * `ApplicantQueue.pending` and the queue stays first come, first served. Within a group the
 * shifts run by date, then time. The input is not mutated.
 */
export function groupApplicationsByApplicant(
	applications: readonly JobApplication[]
): ApplicantGroup[] {
	const groups = new Map<string, JobApplication[]>();
	for (const application of applications) {
		const key = applicantKey(application);
		const group = groups.get(key);
		if (group) group.push(application);
		else groups.set(key, [application]);
	}
	return [...groups].map(([key, list]) => ({
		key,
		applications: list.sort((a, b) => shiftOrder(a).localeCompare(shiftOrder(b)))
	}));
}

/**
 * Thai labels + chip palette per status.
 *
 * `label` is the short form used by the summary tiles; `queueLabel` is the
 * longer wording the approved mockup puts on the row pill ("รอพิจารณาอนุมัติ").
 */
export const APPLICATION_STATUS_META: Record<
	JobApplicationStatus,
	{ label: string; queueLabel: string; chipClass: string }
> = {
	pending_review: {
		label: 'รออนุมัติ',
		queueLabel: 'รอพิจารณาอนุมัติ',
		chipClass: 'bg-amber-50 text-amber-800 ring-amber-200'
	},
	confirmed: {
		label: 'อนุมัติแล้ว',
		queueLabel: 'อนุมัติเข้าร่วมแล้ว',
		chipClass: 'bg-emerald-50 text-emerald-700 ring-emerald-200'
	},
	rejected: {
		label: 'ปฏิเสธ',
		queueLabel: 'ปฏิเสธการสมัคร',
		chipClass: 'bg-rose-50 text-rose-700 ring-rose-200'
	},
	cancelled: {
		label: 'ไม่สะดวก',
		queueLabel: 'ผู้สมัครยกเลิกเอง',
		chipClass: 'bg-muted text-muted-foreground ring-border'
	}
};
