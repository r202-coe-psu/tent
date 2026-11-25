/**
 * One worker call of the shelter close job (CR-243 FR-11..FR-14, FR-17..FR-24): claim or
 * continue a job, run ONE chunk of the step function, persist the cursor. The internal route is
 * a thin wrapper; everything with side effects is injected so it is testable without CouchDB.
 */

import {
	BACKFILL_AUDIT_CONTEXT,
	buildBackfillSummaryAudit
} from './closed-shelter-checkout-backfill';
import type { CouchReq } from './ensure-public-writer';
import { type ShelterCloseJob, type ShelterCloseJobStore } from './shelter-close-job';
import { shelterDbName } from './shelter-access-design';
import { stepShelterClose, type ShelterCloseStepState } from './shelter-close';

export interface ShelterCloseRegistryShelter {
	closed: boolean;
	closed_at: string | null;
}

export interface ShelterCloseWorkerDeps {
	store: ShelterCloseJobStore;
	/** Admin CouchDB request (shelter DBs). */
	couchReq: CouchReq;
	workerId: string;
	/** Epoch ms; fake clock in tests. */
	now?: () => number;
	/** Registry read for finalize: `null` when the shelter does not exist. */
	readShelter: (code: string) => Promise<ShelterCloseRegistryShelter | null>;
	/** Registry write `operation_status = closed` (+ `closed_at`) — FR-20, exactly once. */
	closeShelter: (code: string, actor: string) => Promise<void>;
}

export type ShelterCloseWorkerResult =
	| { kind: 'idle' }
	| {
			kind: 'progress';
			job: ShelterCloseJob;
			/** The job moved on (terminal / other worker) — nothing was written (FR-13). */
			stopped: boolean;
			/** The chunk hit `SHELTER_CLOSE_CHUNK_BUDGET_MS`; its result was dropped and re-done later. */
			budget_exceeded: boolean;
	  };

class ChunkBudgetExceeded extends Error {}

const stateOf = (job: ShelterCloseJob): ShelterCloseStepState => ({
	phase: job.phase,
	cursor: job.cursor,
	sweep_round: job.sweep_round,
	counters: job.counters,
	failures: job.failures
});

/** `_find` / `_all_docs` / `_design/.../_view` reads are POSTs on CouchDB but write nothing. */
function isReadOnlyPost(method: string, path: string): boolean {
	return (
		method === 'POST' &&
		(/\/_find(\?|$)/.test(path) || /\/_all_docs(\?|$)/.test(path) || /\/_view\//.test(path))
	);
}

const patchOf = (state: ShelterCloseStepState) => ({
	phase: state.phase,
	cursor: state.cursor,
	sweep_round: state.sweep_round,
	counters: state.counters,
	failures: state.failures
});

export async function runShelterCloseWorkerStep(
	deps: ShelterCloseWorkerDeps
): Promise<ShelterCloseWorkerResult> {
	const { store, workerId } = deps;
	const nowMs = deps.now ?? (() => Date.now());
	const { config } = store;

	const job = await store.claimNext(workerId);
	if (!job) return { kind: 'idle' };

	const startedAt = nowMs();
	let exceeded = false;
	// The budget is only enforced until the chunk issues its first write. Once evacuees are
	// written the chunk must finish (evacuee → movement → rollback → household): aborting in
	// between leaves people checked out without a movement, and a re-run skips them (FR-12).
	let writing = false;
	const guarded: CouchReq = async (method, path, body) => {
		if (!writing && nowMs() - startedAt > config.chunkBudgetMs) {
			exceeded = true;
			throw new ChunkBudgetExceeded('chunk budget exceeded');
		}
		if (method !== 'GET' && method !== 'HEAD' && !isReadOnlyPost(method, path)) writing = true;
		return deps.couchReq(method, path, body);
	};

	const finalize = async (state: ShelterCloseStepState) => {
		const shelter = await deps.readShelter(job.shelter_code);
		if (!shelter) throw new Error(`Shelter ${job.shelter_code} not found`);
		if (job.mode === 'backfill') {
			// FR-21: registry untouched; one summary audit per shelter (CR-219 FR-30a).
			const audit = buildBackfillSummaryAudit(
				{ code: job.shelter_code, closed_at: shelter.closed_at },
				{
					checked_out: state.counters.checked_out,
					cancelled: state.counters.cancelled,
					households_repaired: state.counters.households_repaired,
					failed: Array.from({ length: state.counters.failed }, () => ({
						evacuee_id: '',
						error: ''
					}))
				},
				job.requested_by
			);
			if (audit) {
				const res = await deps.couchReq(
					'PUT',
					`/${shelterDbName(job.shelter_code)}/${encodeURIComponent(audit._id)}`,
					audit
				);
				if (res.status >= 300 && res.status !== 409) {
					throw new Error(`summary audit not written (${res.status})`);
				}
			}
			return { closed: false };
		}
		// FR-20: written once, here only; an already-closed shelter is left alone.
		if (!shelter.closed) await deps.closeShelter(job.shelter_code, job.requested_by);
		// "closed by this job" (CR-243 §2): false when the registry was already closed.
		return { closed: !shelter.closed };
	};

	let result;
	try {
		result = await stepShelterClose(guarded, job.shelter_code, stateOf(job), {
			createdBy: job.requested_by, // FR-10a
			mode: job.mode,
			auditContext: job.mode === 'backfill' ? { ...BACKFILL_AUDIT_CONTEXT } : undefined,
			maxFailures: config.maxFailures,
			now: () => new Date(nowMs()).toISOString(),
			finalize
		});
	} catch (err) {
		if (!(err instanceof ChunkBudgetExceeded)) {
			await store.abandonLease(job);
			throw err;
		}
		exceeded = true;
	}

	if (exceeded || !result) {
		// Budget spent: keep the old cursor (writes already made are idempotent) and give the lease
		// up, so the next claim is a takeover (FR-14) that counts an attempt. A chunk that always
		// overruns therefore ends as `attempts_exhausted` instead of looping forever.
		await store.abandonLease(job);
		return { kind: 'progress', job, stopped: false, budget_exceeded: true };
	}

	const { state, outcome } = result;
	const saved = outcome
		? await store.finishOwnedJob(
				job,
				{
					...patchOf(state),
					status: outcome.status,
					end_reason: outcome.end_reason,
					closed: outcome.closed
				},
				workerId
			)
		: await store.saveProgress(job, patchOf(state), workerId);
	return { kind: 'progress', job: saved ?? job, stopped: saved === null, budget_exceeded: false };
}
