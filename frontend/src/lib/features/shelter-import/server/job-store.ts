import { ulid } from '$lib/db/ulid';
import type { Shelter } from '$lib/features/shelters/domain/schema';
import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import { createShelterImportLog, type ImportRowResult } from '../domain/import-log';

export const IMPORT_JOB_TYPE = 'shelter_import_job' as const;
export const IMPORT_ITEM_TYPE = 'shelter_import_item' as const;
export const REGISTRY_DB = 'registry';
export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_ATTEMPTS = 3;

export type ImportItemStatus =
	'pending' | 'running' | 'created' | 'updated' | 'skipped' | 'failed' | 'validation_error';
export type ImportJobStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors';

export interface ImportItemError {
	column: string;
	message: string;
	sheet?: string;
	line?: number;
}

export interface ShelterImportItem {
	_id: string;
	_rev?: string;
	type: typeof IMPORT_ITEM_TYPE;
	schema_v: 1;
	job_id: string;
	row: number;
	name: string | null;
	input?: Shelter;
	status: ImportItemStatus;
	attempts: number;
	max_attempts: number;
	lease_until?: string;
	worker_id?: string;
	claim_token?: string;
	dead_lettered_at?: string;
	code?: string;
	errors?: ImportItemError[];
	created_at: string;
	updated_at: string;
	created_by: string;
}

export interface ShelterImportJob {
	_id: string;
	_rev?: string;
	type: typeof IMPORT_JOB_TYPE;
	schema_v: 1;
	filename: string;
	imported_by: string;
	duplicate_action: 'skip' | 'update';
	total: number;
	pending: number;
	running: number;
	succeeded: number;
	failed: number;
	skipped: number;
	status: ImportJobStatus;
	attempt: number;
	audit_log_id?: string;
	audit_logged?: boolean;
	/** Set while a retry is being requeued so a worker cannot terminalize it mid-flight. */
	retry_pending?: boolean;
	created_at: string;
	started_at?: string;
	finished_at?: string;
	updated_at: string;
	created_by: string;
}

export interface ImportJobSummary {
	job: ShelterImportJob;
	items: ShelterImportItem[];
}

function detail(data: unknown): string {
	const value = (data as { reason?: string; error?: string } | null) ?? {};
	return value.reason ?? value.error ?? 'unknown';
}

function assertOk(status: number, operation: string, data: unknown): void {
	if (status >= 400)
		throw new ServiceError('INTERNAL', `${operation} failed (${status}): ${detail(data)}`);
}

function now(): string {
	return new Date().toISOString();
}

function leaseExpired(leaseUntil: string | undefined, at = Date.now()): boolean {
	if (!leaseUntil) return true;
	const timestamp = Date.parse(leaseUntil);
	return !Number.isFinite(timestamp) || timestamp <= at;
}

function jobDocId(jobId: string): string {
	return jobId.startsWith(`${IMPORT_JOB_TYPE}:`) ? jobId : `${IMPORT_JOB_TYPE}:${jobId}`;
}

function jobKey(jobId: string): string {
	return jobDocId(jobId).slice(`${IMPORT_JOB_TYPE}:`.length);
}

function itemPrefix(jobId: string): string {
	return `shelter_import_item:${jobKey(jobId)}:`;
}

async function ensureRegistryDatabase(): Promise<void> {
	const res = await adminRaw(`/${REGISTRY_DB}`, 'PUT');
	if (res.status >= 400 && res.status !== 412) {
		throw new ServiceError(
			'INTERNAL',
			`registry database setup failed (${res.status}): ${detail(res.data)}`
		);
	}
}

async function getDoc<T extends { _id: string }>(id: string): Promise<T | null> {
	const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(id)}`, 'GET');
	if (res.status === 404) return null;
	assertOk(res.status, `read ${id}`, res.data);
	return res.data as T;
}

async function putDoc<T extends { _id: string }>(doc: T): Promise<T> {
	const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(doc._id)}`, 'PUT', doc);
	assertOk(res.status, `write ${doc._id}`, res.data);
	return { ...doc, _rev: (res.data as { rev?: string }).rev };
}

async function deleteDoc(id: string): Promise<void> {
	const current = await getDoc<{ _id: string; _rev?: string }>(id);
	if (!current) return;
	const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(id)}`, 'DELETE', {
		_rev: current._rev
	});
	if (res.status >= 400 && res.status !== 404 && res.status !== 409) {
		assertOk(res.status, `delete ${id}`, res.data);
	}
}

async function putStagedDoc<T extends { _id: string }>(
	doc: T,
	matches: (persisted: T) => boolean
): Promise<T> {
	try {
		return await putDoc(doc);
	} catch (error) {
		// A lost response can leave CouchDB committed while the client sees a
		// network error. Reconcile by deterministic id before declaring staging
		// failed; this is safe because a new job owns every generated id.
		const persisted = await getDoc<T>(doc._id).catch(() => null);
		if (persisted && matches(persisted)) return persisted;
		throw error;
	}
}

async function ensureImportLog(job: ShelterImportJob, items: ShelterImportItem[]): Promise<void> {
	if (!job.audit_log_id) {
		throw new ServiceError('INTERNAL', `Import job ${job._id} has no audit log id`);
	}
	const logId = job.audit_log_id;
	const logIdPart = logId.slice('shelter_import_log:'.length);
	const results: ImportRowResult[] = items.map((item) => ({
		row: item.row,
		name: item.name,
		status:
			item.status === 'created'
				? 'created'
				: item.status === 'updated'
					? 'updated'
					: item.status === 'skipped'
						? 'skipped_duplicate'
						: item.status === 'validation_error'
							? 'validation_error'
							: 'server_error',
		...(item.code ? { code: item.code } : {}),
		...(item.status === 'skipped' || item.status === 'updated' ? { existing_code: item.code } : {}),
		...(item.errors ? { errors: item.errors } : {})
	}));
	const log = createShelterImportLog(
		{
			job_id: job._id,
			attempt: job.attempt ?? 1,
			source: 'shelter',
			filename: job.filename,
			imported_by: job.imported_by,
			total_rows: items.length,
			success_count: items.filter((item) => item.status === 'created' || item.status === 'updated')
				.length,
			updated_count: items.filter((item) => item.status === 'updated').length,
			skipped_count: items.filter((item) => item.status === 'skipped').length,
			error_count: items.filter(
				(item) => item.status === 'failed' || item.status === 'validation_error'
			).length,
			results,
			started_at: job.started_at ?? job.created_at,
			finished_at: job.finished_at ?? now()
		},
		job.created_by,
		logIdPart
	);
	const saved = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(logId)}`, 'PUT', {
		...log
	});
	// The id is allocated once on the job and never reused by another terminal
	// attempt. A conflict means this exact immutable log already exists.
	if (saved.status === 409) return;
	assertOk(saved.status, `write ${logId}`, saved.data);
}

async function listByPrefix<T>(prefix: string): Promise<T[]> {
	const end = `${prefix}\ufff0`;
	const res = await adminRaw(
		`/${REGISTRY_DB}/_all_docs?include_docs=true&startkey=${encodeURIComponent(JSON.stringify(prefix))}&endkey=${encodeURIComponent(JSON.stringify(end))}`,
		'GET'
	);
	if (res.status === 404) return [];
	assertOk(res.status, `list ${prefix}`, res.data);
	return ((res.data as { rows?: { doc?: T }[] }).rows ?? [])
		.map((row) => row.doc)
		.filter((doc): doc is T => Boolean(doc));
}

/** List jobs that may have work available for the import worker. */
export async function listRunnableImportJobs(): Promise<ShelterImportJob[]> {
	const jobs = await listByPrefix<ShelterImportJob>('shelter_import_job:');
	return jobs
		.filter(
			(job) =>
				job.status === 'queued' ||
				job.status === 'running' ||
				((job.status === 'completed' || job.status === 'completed_with_errors') &&
					(job.audit_logged !== true || job.retry_pending === true))
		)
		.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getImportJob(jobId: string): Promise<ImportJobSummary | null> {
	const job = await getDoc<ShelterImportJob>(jobDocId(jobId));
	if (!job) return null;
	const items = await listByPrefix<ShelterImportItem>(itemPrefix(jobId));
	return { job, items: items.sort((a, b) => a.row - b.row) };
}

export async function createImportJob(args: {
	filename: string;
	importedBy: string;
	duplicateAction: 'skip' | 'update';
	rows: Array<{
		row: number;
		name: string | null;
		input?: Shelter;
		errors?: ImportItemError[];
		valid: boolean;
	}>;
}): Promise<ShelterImportJob> {
	if (args.rows.length > MAX_IMPORT_ROWS) {
		throw new ServiceError('VALIDATION', `Import cannot contain more than ${MAX_IMPORT_ROWS} rows`);
	}
	if (new Set(args.rows.map((row) => row.row)).size !== args.rows.length) {
		throw new ServiceError('VALIDATION', 'Import rows must have unique row numbers');
	}
	const timestamp = now();
	const id = ulid();
	await ensureRegistryDatabase();
	const job: ShelterImportJob = {
		_id: `shelter_import_job:${id}`,
		type: IMPORT_JOB_TYPE,
		schema_v: 1,
		filename: args.filename,
		imported_by: args.importedBy,
		duplicate_action: args.duplicateAction,
		total: args.rows.length,
		pending: args.rows.filter((row) => row.valid).length,
		running: 0,
		succeeded: 0,
		failed: args.rows.filter((row) => !row.valid).length,
		skipped: 0,
		status: 'queued',
		attempt: 1,
		audit_logged: false,
		created_at: timestamp,
		updated_at: timestamp,
		created_by: args.importedBy
	};
	// Stage item documents before exposing the job as queued. Otherwise a worker
	// polling between these writes could observe an empty/partial batch and mark
	// the job complete before the remaining rows exist. Clean up a partial stage
	// if CouchDB rejects any item write so no orphaned items remain discoverable.
	const items: ShelterImportItem[] = args.rows.map((row) => ({
		_id: `${itemPrefix(id)}${String(row.row).padStart(6, '0')}`,
		type: IMPORT_ITEM_TYPE,
		schema_v: 1,
		job_id: job._id,
		row: row.row,
		name: row.name,
		...(row.input ? { input: row.input } : {}),
		status: row.valid ? 'pending' : 'validation_error',
		attempts: 0,
		max_attempts: MAX_IMPORT_ATTEMPTS,
		...(row.errors?.length ? { errors: row.errors } : {}),
		created_at: timestamp,
		updated_at: timestamp,
		created_by: args.importedBy
	}));
	let savedJob: ShelterImportJob;
	try {
		// Bounded parallel staging keeps the request duration proportional to a
		// handful of CouchDB round trips while deterministic ids make a lost
		// response safely reconcilable.
		const stageConcurrency = 25;
		for (let start = 0; start < items.length; start += stageConcurrency) {
			const batch = items.slice(start, start + stageConcurrency);
			const results = await Promise.allSettled(
				batch.map((item) =>
					putStagedDoc(
						item,
						(persisted) =>
							persisted.type === IMPORT_ITEM_TYPE &&
							persisted.job_id === job._id &&
							persisted.row === item.row
					)
				)
			);
			const failed = results.find(
				(result): result is PromiseRejectedResult => result.status === 'rejected'
			);
			if (failed) throw failed.reason;
		}
		savedJob = await putStagedDoc(job, (persisted) => persisted.type === IMPORT_JOB_TYPE);
	} catch (error) {
		// Reconcile every deterministic id, including writes whose response was
		// lost before the batch failed. DELETE is best-effort cleanup only.
		await Promise.all(
			[...items.map((item) => item._id), job._id].map((id) => deleteDoc(id).catch(() => undefined))
		);
		throw error;
	}
	if (!args.rows.some((row) => row.valid)) return await recomputeImportJob(id);
	return savedJob;
}

function isTerminal(status: ImportJobStatus): boolean {
	return status === 'completed' || status === 'completed_with_errors';
}

function maxAttempts(item: ShelterImportItem): number {
	return Number.isInteger(item.max_attempts) && item.max_attempts > 0
		? item.max_attempts
		: MAX_IMPORT_ATTEMPTS;
}

async function deadLetterItem(item: ShelterImportItem): Promise<boolean> {
	const next: ShelterImportItem = {
		...item,
		status: 'failed',
		max_attempts: maxAttempts(item),
		lease_until: undefined,
		worker_id: undefined,
		claim_token: undefined,
		dead_lettered_at: item.dead_lettered_at ?? now(),
		errors: item.errors?.length
			? item.errors
			: [{ column: '-', message: `ประมวลผลไม่สำเร็จภายใน ${maxAttempts(item)} ครั้ง` }],
		updated_at: now()
	};
	const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(item._id)}`, 'PUT', next);
	if (res.status === 409) return false;
	assertOk(res.status, `dead-letter ${item._id}`, res.data);
	return true;
}

/** Claim one pending item with an MVCC compare-and-swap lease. */
export async function claimNextImportItem(
	jobId: string,
	workerId: string,
	leaseMs = 5 * 60 * 1000
): Promise<ShelterImportItem | null> {
	const job = await getDoc<ShelterImportJob>(jobDocId(jobId));
	if (!job || (job.status !== 'queued' && job.status !== 'running')) return null;
	const items = await listByPrefix<ShelterImportItem>(itemPrefix(jobId));
	const cutoff = Date.now();
	for (const item of items.sort((a, b) => a.row - b.row)) {
		const expired = leaseExpired(item.lease_until, cutoff);
		if (item.status !== 'pending' && !(item.status === 'running' && expired)) continue;
		if (item.attempts >= maxAttempts(item)) {
			await deadLetterItem(item);
			continue;
		}
		const claimed: ShelterImportItem = {
			...item,
			status: 'running',
			max_attempts: maxAttempts(item),
			worker_id: workerId,
			claim_token: ulid(),
			lease_until: new Date(cutoff + leaseMs).toISOString(),
			attempts: Math.min(item.attempts + 1, maxAttempts(item)),
			updated_at: new Date(cutoff).toISOString()
		};
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(item._id)}`, 'PUT', claimed);
		if (res.status === 409) continue;
		assertOk(res.status, `claim ${item._id}`, res.data);
		return { ...claimed, _rev: (res.data as { rev?: string }).rev };
	}
	return null;
}

type ImportItemPatch = Partial<
	Pick<
		ShelterImportItem,
		| 'status'
		| 'code'
		| 'errors'
		| 'lease_until'
		| 'worker_id'
		| 'claim_token'
		| 'attempts'
		| 'dead_lettered_at'
	>
>;

export async function updateImportItem(
	item: ShelterImportItem,
	patch: ImportItemPatch
): Promise<ShelterImportItem> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await getDoc<ShelterImportItem>(item._id);
		if (!current) throw new ServiceError('INTERNAL', `Import item ${item._id} disappeared`);
		// A claim token fences a worker after its lease is reclaimed. Checking the
		// token in addition to worker_id prevents the old worker from overwriting
		// the successor even when both processes use the same configured id.
		if (
			item.claim_token &&
			(current.status !== 'running' ||
				current.worker_id !== item.worker_id ||
				current.claim_token !== item.claim_token ||
				!current.lease_until ||
				leaseExpired(current.lease_until))
		) {
			return current;
		}
		if (
			!item.claim_token &&
			item.worker_id &&
			(current.status !== 'running' || current.worker_id !== item.worker_id)
		) {
			return current;
		}
		const next: ShelterImportItem = {
			...current,
			...patch,
			max_attempts: maxAttempts(current),
			updated_at: now()
		};
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(next._id)}`, 'PUT', next);
		if (res.status === 409) continue;
		assertOk(res.status, `update ${next._id}`, res.data);
		return { ...next, _rev: (res.data as { rev?: string }).rev };
	}
	throw new ServiceError('CONFLICT', `Could not update import item ${item._id}`);
}

/**
 * Fail fast before a worker performs an external provisioning side effect.
 * The final item update is still fenced by the same token, but this check
 * narrows the window in which a stale worker can continue after lease takeover.
 */
export async function assertImportItemClaim(item: ShelterImportItem): Promise<void> {
	const current = await getDoc<ShelterImportItem>(item._id);
	if (
		!current ||
		current.status !== 'running' ||
		current.worker_id !== item.worker_id ||
		(item.claim_token && current.claim_token !== item.claim_token) ||
		leaseExpired(current.lease_until)
	) {
		throw new ServiceError('CONFLICT', `Import item ${item._id} claim is no longer active`);
	}
}

async function markAuditLogged(jobId: string, logId: string): Promise<ShelterImportJob> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await getDoc<ShelterImportJob>(jobId);
		if (!current) throw new ServiceError('VALIDATION', `Import job ${jobId} not found`);
		if (current.audit_log_id !== logId || current.audit_logged === true) return current;
		const next: ShelterImportJob = { ...current, audit_logged: true, updated_at: now() };
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(next._id)}`, 'PUT', next);
		if (res.status === 409) continue;
		assertOk(res.status, `mark audit ${next._id}`, res.data);
		return { ...next, _rev: (res.data as { rev?: string }).rev };
	}
	throw new ServiceError('CONFLICT', `Could not mark audit log for import job ${jobId}`);
}

export async function recomputeImportJob(jobId: string): Promise<ShelterImportJob> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const job = await getDoc<ShelterImportJob>(jobDocId(jobId));
		if (!job) throw new ServiceError('VALIDATION', `Import job ${jobId} not found`);
		const items = await listByPrefix<ShelterImportItem>(itemPrefix(jobId));
		const pending = items.filter((item) => item.status === 'pending').length;
		const running = items.filter((item) => item.status === 'running').length;
		const succeeded = items.filter(
			(item) => item.status === 'created' || item.status === 'updated'
		).length;
		const skipped = items.filter((item) => item.status === 'skipped').length;
		const failed = items.filter(
			(item) => item.status === 'failed' || item.status === 'validation_error'
		).length;
		const done = pending === 0 && running === 0;

		// A retry has deliberately marked the job before moving item documents.
		// Leave that marker untouched so a status read or worker race cannot create
		// a false terminal attempt in the small requeue window.
		if (job.retry_pending === true) return job;

		// Terminal documents are immutable apart from the one-time audit repair.
		// In particular, a status GET cannot create or overwrite logs.
		if (done && isTerminal(job.status) && job.audit_logged === true) return job;
		if (done && isTerminal(job.status) && job.audit_log_id) {
			await ensureImportLog(job, items);
			return markAuditLogged(job._id, job.audit_log_id);
		}

		const next: ShelterImportJob = {
			...job,
			pending,
			running,
			succeeded,
			failed,
			skipped,
			status: done ? (failed > 0 ? 'completed_with_errors' : 'completed') : 'running',
			...(done
				? { finished_at: job.finished_at ?? now() }
				: { started_at: job.started_at ?? now(), finished_at: undefined }),
			...(done
				? {
						// Jobs created before the durable-attempt fields used the job ULID
						// as their log id. Reuse that deterministic id during repair so a
						// v2 log is not duplicated; new jobs always get a fresh log id.
						audit_log_id:
							job.audit_log_id ??
							(job.audit_logged === undefined
								? `shelter_import_log:${jobKey(job._id)}`
								: `shelter_import_log:${ulid()}`),
						audit_logged: false
					}
				: {}),
			updated_at: now()
		};
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(next._id)}`, 'PUT', next);
		if (res.status === 409) continue;
		assertOk(res.status, `recompute ${next._id}`, res.data);
		const saved = { ...next, _rev: (res.data as { rev?: string }).rev };
		if (!done || !saved.audit_log_id) return saved;
		await ensureImportLog(saved, items);
		return markAuditLogged(saved._id, saved.audit_log_id);
	}
	throw new ServiceError('CONFLICT', `Could not recompute import job ${jobId}`);
}

async function requeueFailedItemWithRevision(
	item: ShelterImportItem,
	expectedRevision?: string
): Promise<boolean> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await getDoc<ShelterImportItem>(item._id);
		if (!current) return false;
		// Recovery is idempotent: another retry worker may already have moved the
		// item to pending/running before this worker got here.
		if (current.status === 'pending' || current.status === 'running') return true;
		if (
			(expectedRevision !== undefined && current._rev !== expectedRevision) ||
			current.status !== 'failed'
		) {
			return false;
		}
		if (current.attempts >= maxAttempts(current)) return false;
		const next: ShelterImportItem = {
			...current,
			status: 'pending',
			max_attempts: maxAttempts(current),
			errors: undefined,
			lease_until: undefined,
			worker_id: undefined,
			claim_token: undefined,
			dead_lettered_at: undefined,
			updated_at: now()
		};
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(next._id)}`, 'PUT', next);
		if (res.status === 409) continue;
		assertOk(res.status, `retry ${next._id}`, res.data);
		return true;
	}
	return false;
}

async function activatePendingRetry(jobId: string): Promise<ShelterImportJob> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await getDoc<ShelterImportJob>(jobDocId(jobId));
		if (!current) throw new ServiceError('VALIDATION', `Import job ${jobId} not found`);
		if (current.retry_pending !== true) return current;
		const next: ShelterImportJob = {
			...current,
			status: 'queued',
			retry_pending: undefined,
			updated_at: now()
		};
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(next._id)}`, 'PUT', next);
		if (res.status === 409) continue;
		assertOk(res.status, `activate retry ${next._id}`, res.data);
		return { ...next, _rev: (res.data as { rev?: string }).rev };
	}
	throw new ServiceError('CONFLICT', `Could not activate retry for import job ${jobId}`);
}

/** Recover a retry request interrupted after its job marker was persisted. */
export async function resumePendingImportRetry(jobId: string): Promise<ShelterImportJob> {
	const summary = await getImportJob(jobId);
	if (!summary) throw new ServiceError('VALIDATION', `Import job ${jobId} not found`);
	if (summary.job.retry_pending !== true) return summary.job;
	for (const item of summary.items) {
		if (item.status === 'failed' && item.attempts < maxAttempts(item)) {
			await requeueFailedItemWithRevision(item);
		}
	}
	const activated = await activatePendingRetry(jobId);
	return await recomputeImportJob(activated._id);
}

export async function retryFailedImportItems(jobId: string): Promise<ImportJobSummary> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const summary = await getImportJob(jobId);
		if (!summary) throw new ServiceError('VALIDATION', `Import job ${jobId} not found`);
		if (summary.job.status !== 'completed_with_errors') {
			throw new ServiceError(
				'CONFLICT',
				`Import job ${jobId} can only retry after completed_with_errors`
			);
		}
		const retryable = summary.items.filter(
			(item) => item.status === 'failed' && item.attempts < maxAttempts(item)
		);
		if (retryable.length === 0) return summary;

		const nextJob: ShelterImportJob = {
			...summary.job,
			// Expose the retry as active immediately. `retry_pending` tells the
			// worker to recover this transaction, so it cannot terminalize an empty
			// queue before the item CAS writes finish.
			status: 'running',
			attempt: (summary.job.attempt ?? 1) + 1,
			pending: summary.job.pending + retryable.length,
			failed: Math.max(0, summary.job.failed - retryable.length),
			running: 0,
			started_at: summary.job.started_at ?? now(),
			finished_at: undefined,
			audit_log_id: undefined,
			audit_logged: false,
			retry_pending: true,
			updated_at: now()
		};
		const res = await adminRaw(
			`/${REGISTRY_DB}/${encodeURIComponent(nextJob._id)}`,
			'PUT',
			nextJob
		);
		if (res.status === 409) continue;
		assertOk(res.status, `start retry ${nextJob._id}`, res.data);
		for (const item of retryable) {
			await requeueFailedItemWithRevision(item, item._rev);
		}
		await activatePendingRetry(jobId);
		await recomputeImportJob(jobId);
		return (await getImportJob(jobId))!;
	}
	throw new ServiceError('CONFLICT', `Could not retry import job ${jobId}`);
}
