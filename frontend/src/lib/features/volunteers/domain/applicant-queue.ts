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
