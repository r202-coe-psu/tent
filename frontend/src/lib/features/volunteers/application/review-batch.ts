import type { JobApplication } from '../domain/job-application.schema';

export type ReviewFailure = { application: JobApplication; message: string };

/**
 * Review several applications one after another — "อนุมัติทุกกะ" (#716).
 *
 * Sequential on purpose: each approval takes a slot on the same `job` doc, and running them
 * side by side would only race on its `_rev`. A failure (shift full, already decided by
 * someone else, …) is collected and the rest still run, so one bad shift never holds back
 * the others.
 */
export async function reviewInOrder(
	applications: readonly JobApplication[],
	review: (application: JobApplication) => Promise<unknown>
): Promise<{ done: JobApplication[]; failed: ReviewFailure[] }> {
	const done: JobApplication[] = [];
	const failed: ReviewFailure[] = [];
	for (const application of applications) {
		try {
			await review(application);
			done.push(application);
		} catch (error) {
			failed.push({
				application,
				message: error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ'
			});
		}
	}
	return { done, failed };
}
