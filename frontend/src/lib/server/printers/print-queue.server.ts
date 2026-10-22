// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel will pull client UI/query code
import { leaseSecFor } from '$lib/features/printers/domain/print-job-timing';

export type PrintJobStatus = 'pending' | 'printing' | 'printed' | 'failed' | 'expired';

/** `print_job:{ulid}` doc in DB `printing` (print-server-implementation-plan §3.3). Timestamps are ISO strings. */
export interface PrintJobDoc {
	_id: string;
	_rev?: string;
	type: 'print_job';
	schema_v: 1;
	shelter_code: string;
	/** `print_device:{device_id}` */
	printer_id: string;
	status: PrintJobStatus;
	label_count: number;
	source: 'walk_in' | 'evacuee_qr' | 'test';
	created_at: string;
	created_by: string;
	expires_at: string;
	claimed_at: string | null;
	lease_until: string | null;
	finished_at: string | null;
	printed: number;
	error_code: string | null;
	/** Present while `pending`/`printing`; must be absent in every terminal write (PDPA §3.5). */
	_attachments?: Record<string, unknown>;
}

export interface WaitOptions {
	timeoutMs: number;
	signal: AbortSignal;
}

export type PrintJobPutResult = { ok: true; rev: string } | { conflict: true };

/** Narrow port over the `printing` DB; the real adapter lives in `printer-server.ts`. */
export interface PrintJobStore {
	findJobs(query: { status: PrintJobStatus; printerId?: string }): Promise<PrintJobDoc[]>;
	/** Full doc `_id` (`print_job:{ulid}`); null when missing. */
	get(id: string): Promise<PrintJobDoc | null>;
	put(doc: PrintJobDoc): Promise<PrintJobPutResult>;
	getLabels(jobId: string): Promise<string[]>;
	/** Opaque change-feed position (CouchDB `update_seq`) of the `printing` DB. */
	pendingCursor(): Promise<string>;
	/** Resolves when a pending job of the printer changed after `since`, on timeout, or on abort. */
	waitForPending(printerId: string, since: string, opts: WaitOptions): Promise<void>;
}

export interface ClaimedJob {
	/** `lease_sec` lets the Pi bound its report retries without trusting its own clock. */
	job: { id: string; label_count: number; lease_sec: number; lease_until: string };
	labels: string[];
}

/** Terminal PUT: new final status, `finished_at = now`, and no `_attachments` in the same write. */
export function terminal(
	doc: PrintJobDoc,
	status: 'printed' | 'failed' | 'expired',
	now: Date,
	fields: Partial<Pick<PrintJobDoc, 'printed' | 'error_code'>> = {}
): PrintJobDoc {
	const next: PrintJobDoc = { ...doc, ...fields, status, finished_at: now.toISOString() };
	delete next._attachments;
	return next;
}

/** `ts <= now` (a deadline that is exactly now counts as passed). */
function isDue(ts: string, now: Date): boolean {
	return Date.parse(ts) <= now.getTime();
}

const JOB_ID_PREFIX = 'print_job:';

/**
 * Claim the oldest pending job of a printer: PUT it as `printing` with a server-clock lease sized
 * by its label count (`leaseSecFor`), unless `leaseSec` overrides it.
 */
export async function claimNextJob(
	store: PrintJobStore,
	printerId: string,
	opts: { now: Date; leaseSec?: number }
): Promise<ClaimedJob | null> {
	const pending = await store.findJobs({ status: 'pending', printerId });
	const oldestFirst = [...pending].sort((a, b) => a.created_at.localeCompare(b.created_at));

	for (const candidate of oldestFirst) {
		if (isDue(candidate.expires_at, opts.now)) {
			await store.put(terminal(candidate, 'expired', opts.now));
			continue;
		}
		const leaseSec = opts.leaseSec ?? leaseSecFor(candidate.label_count);
		const leaseUntil = new Date(opts.now.getTime() + leaseSec * 1000);
		const claimed: PrintJobDoc = {
			...candidate,
			status: 'printing',
			claimed_at: opts.now.toISOString(),
			lease_until: leaseUntil.toISOString()
		};
		const result = await store.put(claimed);
		if ('conflict' in result) continue;

		return {
			job: {
				id: candidate._id.slice(JOB_ID_PREFIX.length),
				label_count: candidate.label_count,
				lease_sec: leaseSec,
				lease_until: claimed.lease_until as string
			},
			labels: await store.getLabels(candidate._id)
		};
	}
	return null;
}

/**
 * Long-poll claim (plan §4.1): read the cursor, try to claim, and if nothing is pending wait on
 * the change feed for the remaining time. The cursor is re-read every round, before the claim
 * attempt, so a job created between the claim and the wait cannot be missed.
 */
export async function waitForNextJob(
	store: PrintJobStore,
	printerId: string,
	opts: { now: () => Date; waitMs: number; signal: AbortSignal; leaseSec?: number }
): Promise<ClaimedJob | null> {
	const deadline = opts.now().getTime() + opts.waitMs;
	for (;;) {
		if (opts.signal.aborted || deadline - opts.now().getTime() <= 0) return null;
		const cursor = await store.pendingCursor();
		const claimed = await claimNextJob(store, printerId, {
			now: opts.now(),
			leaseSec: opts.leaseSec
		});
		if (claimed) return claimed;
		await store.waitForPending(printerId, cursor, {
			timeoutMs: deadline - opts.now().getTime(),
			signal: opts.signal
		});
	}
}

/** The job is not (or no longer) this printer's `printing` job — route maps it to 409. */
export class PrintJobConflictError extends Error {
	constructor() {
		super('Print job is not a printing job of this printer');
		this.name = 'PrintJobConflictError';
	}
}

export async function reportResult(
	store: PrintJobStore,
	printerId: string,
	jobId: string,
	result: { printed: number; error_code?: string | null },
	now: Date
): Promise<'printed' | 'failed'> {
	const doc = await store.get(`${JOB_ID_PREFIX}${jobId}`);
	if (!doc || doc.printer_id !== printerId || doc.status !== 'printing') {
		throw new PrintJobConflictError();
	}
	const errorCode = result.error_code ?? null;
	const status = errorCode === null ? 'printed' : 'failed';
	const written = await store.put(
		terminal(doc, status, now, { printed: result.printed, error_code: errorCode })
	);
	if ('conflict' in written) throw new PrintJobConflictError();
	return status;
}

/** Pi restarted (`hello`): whatever it was printing is gone, so fail it as `agent_restart`. */
export async function failInFlight(
	store: PrintJobStore,
	printerId: string,
	now: Date
): Promise<number> {
	const inFlight = await store.findJobs({ status: 'printing', printerId });
	let failed = 0;
	for (const doc of inFlight) {
		const written = await store.put(terminal(doc, 'failed', now, { error_code: 'agent_restart' }));
		if (!('conflict' in written)) failed += 1;
	}
	return failed;
}

/**
 * Housekeeping sweeper: `printing` jobs past their lease -> `failed (lease_expired)`, `pending`
 * jobs past `expires_at` -> `expired`. A PUT conflict means someone else moved the job; skip it.
 */
export async function sweepJobs(
	store: PrintJobStore,
	now: Date
): Promise<{ failed: number; expired: number }> {
	let failed = 0;
	let expired = 0;
	for (const doc of await store.findJobs({ status: 'printing' })) {
		if (doc.lease_until === null || !isDue(doc.lease_until, now)) continue;
		const written = await store.put(terminal(doc, 'failed', now, { error_code: 'lease_expired' }));
		if (!('conflict' in written)) failed += 1;
	}
	for (const doc of await store.findJobs({ status: 'pending' })) {
		if (!isDue(doc.expires_at, now)) continue;
		const written = await store.put(terminal(doc, 'expired', now));
		if (!('conflict' in written)) expired += 1;
	}
	return { failed, expired };
}

/** Retention port over the `printing` DB (plan §3.5); the real adapter lives in `printer-server.ts`. */
export interface PrintJobRetentionStore {
	/** One batch of terminal jobs whose `finished_at` is before `cutoff` (ISO). */
	findFinishedBefore(cutoff: string): Promise<PrintJobDoc[]>;
	/** `_purge` the docs at their `_rev`: each doc leaves the DB with its whole history. */
	purge(docs: PrintJobDoc[]): Promise<void>;
	/** Start `_compact`, dropping old revisions that still carry label images. */
	compact(): Promise<void>;
}

/** O-1 (team proposal, not final): keep finished jobs for 7 days, then purge them. */
export const PRINT_JOB_RETENTION_DAYS = 7;
const DAY_MS = 86_400_000;
/** Upper bound on purge rounds per run, so a huge backlog cannot pin the process. */
const MAX_PURGE_BATCHES = 50;

/**
 * PDPA retention (plan §3.5 steps 2–3): purge terminal jobs finished more than
 * `PRINT_JOB_RETENTION_DAYS` ago, then compact — even when nothing was purged, because the
 * revisions before each terminal PUT still hold the label PNGs until compaction.
 */
export async function applyRetention(store: PrintJobRetentionStore, now: Date): Promise<number> {
	const cutoff = new Date(now.getTime() - PRINT_JOB_RETENTION_DAYS * DAY_MS).toISOString();
	let purged = 0;
	for (let round = 0; round < MAX_PURGE_BATCHES; round += 1) {
		const docs = await store.findFinishedBefore(cutoff);
		if (docs.length === 0) break;
		await store.purge(docs);
		purged += docs.length;
	}
	await store.compact();
	return purged;
}
