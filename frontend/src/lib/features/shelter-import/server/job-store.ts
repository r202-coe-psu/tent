import { ulid } from '$lib/db/ulid';
import type { Shelter } from '$lib/features/shelters/domain/schema';
import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import { normalizeShelterName } from '../domain/duplicates';
import {
	createShelterImportLog,
	type ImportRowResult,
	type ShelterImportLog
} from '../domain/import-log';

export const IMPORT_JOB_TYPE = 'shelter_import_job' as const;
export const IMPORT_ITEM_TYPE = 'shelter_import_item' as const;
const IMPORT_NAME_LOCK_TYPE = 'shelter_import_name_lock' as const;
export const REGISTRY_DB = 'registry';
export const MAX_IMPORT_ROWS = 1000;

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
	lease_until?: string;
	worker_id?: string;
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

interface ImportNameLock {
	_id: string;
	_rev?: string;
	type: typeof IMPORT_NAME_LOCK_TYPE;
	name: string;
	job_id: string;
	item_id: string;
	worker_id: string;
	lease_until: string;
	updated_at: string;
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

function itemPrefix(jobId: string): string {
	return `shelter_import_item:${jobId}:`;
}

function nameLockId(name: string): string {
	return `shelter_import_name_lock:${encodeURIComponent(normalizeShelterName(name))}`;
}

/**
 * Serialize same-name imports across worker processes. The lease makes a
 * crashed worker's lock recoverable without introducing an in-memory mutex.
 */
export async function acquireImportNameLock(args: {
	name: string;
	jobId: string;
	itemId: string;
	workerId: string;
	leaseMs?: number;
}): Promise<boolean> {
	const normalized = normalizeShelterName(args.name);
	if (!normalized) return true;
	const id = nameLockId(normalized);
	const leaseUntil = new Date(Date.now() + (args.leaseMs ?? 5 * 60 * 1000)).toISOString();
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await getDoc<ImportNameLock>(id);
		if (
			current &&
			Date.parse(current.lease_until) > Date.now() &&
			(current.job_id !== args.jobId || current.item_id !== args.itemId)
		) {
			return false;
		}
		const next: ImportNameLock = {
			_id: id,
			type: IMPORT_NAME_LOCK_TYPE,
			name: normalized,
			job_id: args.jobId,
			item_id: args.itemId,
			worker_id: args.workerId,
			lease_until: leaseUntil,
			updated_at: now(),
			...(current?._rev ? { _rev: current._rev } : {})
		};
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(id)}`, 'PUT', next);
		if (res.status === 409) continue;
		assertOk(res.status, `acquire name lock ${normalized}`, res.data);
		return true;
	}
	return false;
}

export async function releaseImportNameLock(args: {
	name: string;
	jobId: string;
	itemId: string;
}): Promise<void> {
	const normalized = normalizeShelterName(args.name);
	if (!normalized) return;
	const id = nameLockId(normalized);
	const current = await getDoc<ImportNameLock>(id);
	if (!current || current.job_id !== args.jobId || current.item_id !== args.itemId) {
		return;
	}
	const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(id)}`, 'DELETE', {
		_rev: current._rev
	});
	if (res.status >= 400 && res.status !== 404 && res.status !== 409) {
		assertOk(res.status, `release name lock ${normalized}`, res.data);
	}
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

async function ensureImportLog(job: ShelterImportJob, items: ShelterImportItem[]): Promise<void> {
	const logId = `shelter_import_log:${job._id.slice('shelter_import_job:'.length)}`;
	const existing = await getDoc<ShelterImportLog>(logId);
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
		job.created_by
	);
	const saved = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(logId)}`, 'PUT', {
		...log,
		_id: logId,
		...(existing?._rev ? { _rev: existing._rev } : {})
	});
	// Two status readers may finish the same job concurrently. The first log
	// wins; a CouchDB conflict means the other reader can safely treat it as
	// already persisted.
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
		.filter((job) => job.status === 'queued' || job.status === 'running')
		.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getImportJob(jobId: string): Promise<ImportJobSummary | null> {
	const job = await getDoc<ShelterImportJob>(`shelter_import_job:${jobId}`);
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
		status: args.rows.some((row) => row.valid) ? 'queued' : 'completed_with_errors',
		created_at: timestamp,
		updated_at: timestamp,
		...(args.rows.some((row) => row.valid) ? {} : { finished_at: timestamp }),
		created_by: args.importedBy
	};
	// Stage item documents before exposing the job as queued. Otherwise a worker
	// polling between these writes could observe an empty/partial batch and mark
	// the job complete before the remaining rows exist. Clean up a partial stage
	// if CouchDB rejects any item write so no orphaned items remain discoverable.
	const stagedItems: ShelterImportItem[] = [];
	try {
		for (const row of args.rows) {
			const item: ShelterImportItem = {
				_id: `${itemPrefix(id)}${row.row}`,
				type: IMPORT_ITEM_TYPE,
				schema_v: 1,
				job_id: id,
				row: row.row,
				name: row.name,
				...(row.input ? { input: row.input } : {}),
				status: row.valid ? 'pending' : 'validation_error',
				attempts: 0,
				...(row.errors?.length ? { errors: row.errors } : {}),
				created_at: timestamp,
				updated_at: timestamp,
				created_by: args.importedBy
			};
			stagedItems.push(await putDoc(item));
		}
		await putDoc(job);
	} catch (error) {
		await Promise.all(
			stagedItems.map((item) =>
				adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(item._id)}`, 'DELETE', {
					_rev: item._rev
				}).catch(() => undefined)
			)
		);
		throw error;
	}
	if (!args.rows.some((row) => row.valid)) await recomputeImportJob(id);
	return job;
}

/** Claim one pending item with an MVCC compare-and-swap lease. */
export async function claimNextImportItem(
	jobId: string,
	workerId: string,
	leaseMs = 5 * 60 * 1000
): Promise<ShelterImportItem | null> {
	const items = await listByPrefix<ShelterImportItem>(itemPrefix(jobId));
	const cutoff = Date.now();
	for (const item of items.sort((a, b) => a.row - b.row)) {
		const leaseExpired = !item.lease_until || Date.parse(item.lease_until) <= cutoff;
		if (item.status !== 'pending' && !(item.status === 'running' && leaseExpired)) continue;
		const claimed: ShelterImportItem = {
			...item,
			status: 'running',
			worker_id: workerId,
			lease_until: new Date(cutoff + leaseMs).toISOString(),
			attempts: item.attempts + 1,
			updated_at: new Date(cutoff).toISOString()
		};
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(item._id)}`, 'PUT', claimed);
		if (res.status === 409) continue;
		assertOk(res.status, `claim ${item._id}`, res.data);
		return { ...claimed, _rev: (res.data as { rev?: string }).rev };
	}
	return null;
}

export async function updateImportItem(
	item: ShelterImportItem,
	patch: Partial<
		Pick<ShelterImportItem, 'status' | 'code' | 'errors' | 'lease_until' | 'worker_id'>
	>
): Promise<ShelterImportItem> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const current = await getDoc<ShelterImportItem>(item._id);
		if (!current) throw new ServiceError('INTERNAL', `Import item ${item._id} disappeared`);
		// A worker whose lease was taken over must not be able to overwrite the
		// successor's result. Returning the current document lets the caller
		// stop cleanly without turning a lease race into a retry storm.
		if (item.worker_id && (current.status !== 'running' || current.worker_id !== item.worker_id)) {
			return current;
		}
		const next = { ...current, ...patch, updated_at: now() };
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(next._id)}`, 'PUT', next);
		if (res.status === 409) continue;
		assertOk(res.status, `update ${next._id}`, res.data);
		return { ...next, _rev: (res.data as { rev?: string }).rev };
	}
	throw new ServiceError('CONFLICT', `Could not update import item ${item._id}`);
}

export async function recomputeImportJob(jobId: string): Promise<ShelterImportJob> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const job = await getDoc<ShelterImportJob>(`shelter_import_job:${jobId}`);
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
			updated_at: now()
		};
		const res = await adminRaw(`/${REGISTRY_DB}/${encodeURIComponent(next._id)}`, 'PUT', next);
		if (res.status === 409) continue;
		assertOk(res.status, `recompute ${next._id}`, res.data);
		const saved = { ...next, _rev: (res.data as { rev?: string }).rev };
		if (done) await ensureImportLog(saved, items);
		return saved;
	}
	throw new ServiceError('CONFLICT', `Could not recompute import job ${jobId}`);
}

export async function retryFailedImportItems(jobId: string): Promise<ImportJobSummary> {
	const summary = await getImportJob(jobId);
	if (!summary) throw new ServiceError('VALIDATION', `Import job ${jobId} not found`);
	for (const item of summary.items) {
		if (item.status !== 'failed') continue;
		await updateImportItem(item, {
			status: 'pending',
			errors: undefined,
			lease_until: undefined,
			worker_id: undefined
		});
	}
	await recomputeImportJob(jobId);
	return (await getImportJob(jobId))!;
}
