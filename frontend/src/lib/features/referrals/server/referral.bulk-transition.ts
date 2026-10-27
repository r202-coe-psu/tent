import type { Referral, ReferralStatus } from '../domain/referral.schema';
import { CouchDbReferralServerRepository } from './referral.server-repository';
import { transitionWithRetry, type TransitionRepo } from './referral.transition-retry';

/** CR-167 FR-B8: max referrals transitioned at once (never `Promise.all` over a whole chunk — EMFILE, CR-126). */
export const BULK_TRANSITION_CONCURRENCY = 5;

/** CR-167 FR-B6: max ids per bulk request. */
export const BULK_TRANSITION_MAX_IDS = 200;

export type BulkTransitionFailure = { id: string; error: string };

export type BulkTransitionResult = {
	/** The saved referral docs (CR-167 FR-B3), in input order. */
	succeeded: Referral[];
	failed: BulkTransitionFailure[];
};

export type BulkTransitionOptions = {
	/** Parallel workers. Defaults to {@link BULK_TRANSITION_CONCURRENCY}. */
	concurrency?: number;
	/** Injected for tests; defaults to a `central_ops` repository scoped to `actorShelter`. */
	repo?: TransitionRepo;
};

/**
 * Transition many referrals to `to` with ONE reason (CR-167 FR-B1..B9). Partial success, no
 * rollback: every id lands in exactly one of `succeeded` / `failed`.
 *
 * Each id goes through the same per-item path as `PATCH …/[id]/transition`
 * (`repo.transition` → auth + state matrix + capacity transfer, with the 409 retry), so bulk
 * cannot bypass any rule. Callable without HTTP (e.g. from the referral worker, CR-168).
 * `actor` and `actorShelter` come from the verified session, never from a request body.
 */
export async function bulkTransition(
	ids: readonly string[],
	to: ReferralStatus,
	reason: string | undefined,
	actor: string,
	actorShelter: string,
	options: BulkTransitionOptions = {}
): Promise<BulkTransitionResult> {
	const repo = options.repo ?? new CouchDbReferralServerRepository('central_ops', actorShelter);
	const workers = Math.max(1, Math.floor(options.concurrency ?? BULK_TRANSITION_CONCURRENCY));
	const queue = [...new Set(ids)];

	const succeeded = new Map<string, Referral>();
	const failed = new Map<string, string>();
	let next = 0;

	async function worker(): Promise<void> {
		while (next < queue.length) {
			const id = queue[next++];
			try {
				succeeded.set(id, await transitionWithRetry(repo, id, to, actor, reason, actorShelter));
			} catch (e: unknown) {
				failed.set(id, e instanceof Error ? e.message : 'Unknown error');
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, worker));

	// Report in input order regardless of completion order.
	return {
		succeeded: queue.filter((id) => succeeded.has(id)).map((id) => succeeded.get(id)!),
		failed: queue.filter((id) => failed.has(id)).map((id) => ({ id, error: failed.get(id)! }))
	};
}
