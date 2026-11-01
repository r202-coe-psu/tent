/* eslint-disable no-restricted-imports -- server-safe domain rules; the feature barrel pulls client UI/query code */
import { isPrintableLabel } from '$lib/features/printers/domain/label-png';
import { MAX_LABELS_PER_JOB } from '$lib/features/printers/domain/print-job.schema';
import { isPendingExpired, leaseSecFor } from '$lib/features/printers/domain/print-job-timing';
/* eslint-enable no-restricted-imports */

export type PrintJobStatus = 'pending' | 'printing' | 'printed' | 'failed' | 'expired';

/** `print_job:{ulid}` doc in DB `printing_{code}` (print-server-implementation-plan §3.3). Timestamps are ISO strings. */
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

/** A job doc plus its label images (base64, label order) from a single read. */
export interface PrintJobWithLabels {
	/** `_attachments` are stubs, so a PUT of this doc keeps the attachments. */
	doc: PrintJobDoc;
	labels: string[];
}

/** Narrow port over one shelter's `printing_{code}` DB; the real adapter is `print-job.service-store.ts`. */
export interface PrintJobStore {
	findJobs(query: { status: PrintJobStatus; printerId?: string }): Promise<PrintJobDoc[]>;
	/** Full doc `_id` (`print_job:{ulid}`); null when missing. */
	get(id: string): Promise<PrintJobDoc | null>;
	put(doc: PrintJobDoc): Promise<PrintJobPutResult>;
	getLabels(jobId: string): Promise<string[]>;
	/** Doc and labels in one read; null when the job is missing. */
	getWithLabels(id: string): Promise<PrintJobWithLabels | null>;
	/** Opaque change-feed position (CouchDB `update_seq`) of the shelter's printing DB. */
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

/** Labels and provenance of a read job are what a printer may be handed (FR-12a). */
function isClaimable(read: PrintJobWithLabels, printerId: string, shelterCode: string): boolean {
	const { doc, labels } = read;
	return (
		doc.printer_id === printerId &&
		doc.shelter_code.toUpperCase() === shelterCode.toUpperCase() &&
		Number.isInteger(doc.label_count) &&
		doc.label_count >= 1 &&
		doc.label_count <= MAX_LABELS_PER_JOB &&
		labels.length === doc.label_count &&
		labels.every(isPrintableLabel)
	);
}

/**
 * Claim the oldest pending job of a printer: PUT it as `printing` with a server-clock lease sized
 * by its label count (`leaseSec`), unless `leaseSec` overrides it. Staff can write jobs straight
 * into CouchDB, so each candidate is rechecked first (FR-12, FR-12a): past its clock-bounded
 * expiry -> `expired`; wrong label count / size / format or foreign shelter / printer ->
 * `failed (invalid_label)`. Either way the next candidate is tried. `shelterCode` is the shelter
 * of the polling device, i.e. of the DB behind `store`.
 */
export async function claimNextJob(
	store: PrintJobStore,
	printerId: string,
	opts: { now: Date; shelterCode: string; leaseSec?: number }
): Promise<ClaimedJob | null> {
	const pending = await store.findJobs({ status: 'pending', printerId });
	const oldestFirst = [...pending].sort((a, b) => a.created_at.localeCompare(b.created_at));

	for (const candidate of oldestFirst) {
		if (isPendingExpired(candidate, opts.now)) {
			await store.put(terminal(candidate, 'expired', opts.now));
			continue;
		}
		const read = await store.getWithLabels(candidate._id);
		if (!read) continue;
		if (!isClaimable(read, printerId, opts.shelterCode)) {
			await store.put(terminal(read.doc, 'failed', opts.now, { error_code: 'invalid_label' }));
			continue;
		}

		const { doc, labels } = read;
		const leaseSec = opts.leaseSec ?? leaseSecFor(doc.label_count);
		const leaseUntil = new Date(opts.now.getTime() + leaseSec * 1000);
		const claimed: PrintJobDoc = {
			...doc,
			status: 'printing',
			claimed_at: opts.now.toISOString(),
			lease_until: leaseUntil.toISOString()
		};
		const result = await store.put(claimed);
		if ('conflict' in result) continue;

		return {
			job: {
				id: doc._id.slice(JOB_ID_PREFIX.length),
				label_count: doc.label_count,
				lease_sec: leaseSec,
				lease_until: claimed.lease_until as string
			},
			labels
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
	opts: {
		now: () => Date;
		shelterCode: string;
		waitMs: number;
		signal: AbortSignal;
		leaseSec?: number;
	}
): Promise<ClaimedJob | null> {
	const deadline = opts.now().getTime() + opts.waitMs;
	for (;;) {
		if (opts.signal.aborted || deadline - opts.now().getTime() <= 0) return null;
		const cursor = await store.pendingCursor();
		const claimed = await claimNextJob(store, printerId, {
			now: opts.now(),
			shelterCode: opts.shelterCode,
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
 * jobs past their clock-bounded expiry (`isPendingExpired`) -> `expired`. A PUT conflict means
 * someone else moved the job; skip it.
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
		if (!isPendingExpired(doc, now)) continue;
		const written = await store.put(terminal(doc, 'expired', now));
		if (!('conflict' in written)) expired += 1;
	}
	return { failed, expired };
}

/** Retention port over one shelter's `printing_{code}` DB (plan §3.5); the real adapter is `print-job.service-store.ts`. */
export interface PrintJobRetentionStore {
	/** One batch of terminal jobs whose `finished_at` is before `cutoff` (ISO). */
	findFinishedBefore(cutoff: string): Promise<PrintJobDoc[]>;
	/**
	 * Remove the docs at their `_rev` (`_bulk_docs` `_deleted`: CouchDB `_purge` needs the server
	 * admin, which `printing_service` must not hold). The tombstone drops the doc body; the old
	 * revisions still carrying label images go at the `compact` that follows. Called with at most
	 * `PURGE_BATCH_SIZE` docs.
	 */
	purge(docs: PrintJobDoc[]): Promise<void>;
	/** Start `_compact`, dropping old revisions that still carry label images. */
	compact(): Promise<void>;
}

/** O-1 (team proposal, not final): keep finished jobs for 7 days, then remove them. */
export const PRINT_JOB_RETENTION_DAYS = 7;
const DAY_MS = 86_400_000;
/** Upper bound on removal rounds per run, so a huge backlog cannot pin the process. */
const MAX_PURGE_BATCHES = 50;
/** Docs per removal request (`_bulk_docs`), keeping each request small. */
export const PURGE_BATCH_SIZE = 100;

/**
 * PDPA retention (plan §3.5 steps 2–3): remove terminal jobs finished more than
 * `PRINT_JOB_RETENTION_DAYS` ago, then compact — even when nothing was removed or a removal failed,
 * because the revisions before each terminal PUT still hold the label PNGs until compaction.
 */
export async function applyRetention(store: PrintJobRetentionStore, now: Date): Promise<number> {
	const cutoff = new Date(now.getTime() - PRINT_JOB_RETENTION_DAYS * DAY_MS).toISOString();
	let purged = 0;
	try {
		for (let round = 0; round < MAX_PURGE_BATCHES; round += 1) {
			const docs = await store.findFinishedBefore(cutoff);
			if (docs.length === 0) break;
			for (let i = 0; i < docs.length; i += PURGE_BATCH_SIZE) {
				const batch = docs.slice(i, i + PURGE_BATCH_SIZE);
				await store.purge(batch);
				purged += batch.length;
			}
		}
	} finally {
		await store.compact();
	}
	return purged;
}
