import type { Referral, ReferralStatus, ReferralType } from '../domain/referral.schema';
import { isM5Referral } from '../domain/referral.m5';
import { M5BatchError, cancelM5Batch } from './referral.m5.server';
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

// ---------------------------------------------------------------------------
// Bulk with M5 batches (draft CR — referral M5 §4 rule 7, D11) and role-limited types (D16)
// ---------------------------------------------------------------------------

/** M5 needs a withdrawal reason; CR-167 bulk makes it optional. */
const DEFAULT_M5_WITHDRAW_REASON = 'ถอนคำขอจากศูนย์';

export type BulkTransitionWithM5Options = {
	/** Referral types the caller may act on; `null` = all (D16). */
	allowedTypes: readonly ReferralType[] | null;
	repo?: CouchDbReferralServerRepository;
};

/**
 * `bulkTransition()` plus the M5 rules: a selected `m5` referral being withdrawn (`sent →
 * closed`) withdraws its WHOLE batch through M5 once per `batch_id` (D11); a batch M5 refuses
 * (`CANCEL_NEEDS_MOPH`, …) fails every selected member without failing the bulk. Every other id
 * goes through the per-item path, where the M5 guard still applies.
 */
export async function bulkTransitionWithM5(
	ids: readonly string[],
	to: ReferralStatus,
	reason: string | undefined,
	actor: string,
	actorShelter: string,
	options: BulkTransitionWithM5Options
): Promise<BulkTransitionResult> {
	const repo = options.repo ?? new CouchDbReferralServerRepository('central_ops', actorShelter);
	const queue = [...new Set(ids)];
	const docs = new Map<string, Referral | null>();
	let next = 0;
	async function reader(): Promise<void> {
		while (next < queue.length) {
			const id = queue[next++];
			docs.set(id, await repo.get(id).catch(() => null));
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(BULK_TRANSITION_CONCURRENCY, queue.length) }, reader)
	);

	const succeeded = new Map<string, Referral>();
	const failed = new Map<string, string>();
	const m5Batches = new Map<string, string[]>();
	const plain: string[] = [];

	for (const id of queue) {
		const doc = docs.get(id);
		if (!doc) {
			plain.push(id); // let the per-item path report not-found the usual way
			continue;
		}
		const type = doc.referral_type ?? 'medical-emergency';
		if (options.allowedTypes && !options.allowedTypes.includes(type)) {
			failed.set(id, 'Forbidden: referral type not allowed for this role');
			continue;
		}
		const batchId = 'batch_id' in doc ? doc.batch_id : undefined;
		if (to === 'closed' && doc.status === 'sent' && isM5Referral(doc) && batchId) {
			m5Batches.set(batchId, [...(m5Batches.get(batchId) ?? []), id]);
		} else {
			plain.push(id);
		}
	}

	for (const [batchId, selected] of m5Batches) {
		try {
			const result = await cancelM5Batch(
				{ repo, shelterCode: actorShelter, actor },
				batchId,
				reason || DEFAULT_M5_WITHDRAW_REASON
			);
			const closed = new Map(result.closed.map((r) => [r._id, r]));
			const memberErrors = new Map(result.failed.map((f) => [f.id, f.error]));
			for (const id of selected) {
				const doc = closed.get(id);
				if (doc) succeeded.set(id, doc);
				else failed.set(id, memberErrors.get(id) ?? 'Withdrawal not recorded');
			}
		} catch (e: unknown) {
			const message = e instanceof M5BatchError ? `${e.code}: ${e.message}` : String(e);
			for (const id of selected) failed.set(id, message);
		}
	}

	if (plain.length) {
		const rest = await bulkTransition(plain, to, reason, actor, actorShelter, { repo });
		for (const doc of rest.succeeded) succeeded.set(doc._id, doc);
		for (const f of rest.failed) failed.set(f.id, f.error);
	}

	return {
		succeeded: queue.filter((id) => succeeded.has(id)).map((id) => succeeded.get(id)!),
		failed: queue.filter((id) => failed.has(id)).map((id) => ({ id, error: failed.get(id)! }))
	};
}
