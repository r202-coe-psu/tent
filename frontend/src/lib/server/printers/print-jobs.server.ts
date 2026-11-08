import { ulid } from '$lib/db/ulid';
import { ServiceError } from '$lib/server/session-auth';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel will pull client UI/query code
import { canPrintSource } from '$lib/features/printers/domain/print-permission';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel will pull client UI/query code
import type { PrintJobCreateInput } from '$lib/features/printers/domain/print-job.schema';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel will pull client UI/query code
import { isPrinterOnline } from '$lib/features/printers/domain/printer-status';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel will pull client UI/query code
import { JOB_TTL_SEC } from '$lib/features/printers/domain/print-job-timing';
import {
	PrintDependencyError,
	PrintShelterDbMissingError,
	type PrintDeviceDoc
} from './device-credentials';
import type { PrintJobDoc } from './print-queue.server';

/** Write side of the `printing` DB: one PUT, the doc already carries its `_attachments`. */
export interface PrintJobCreator {
	/** Throws `PrintJobConflictError` when a doc with this `_id` already exists (HTTP 409). */
	createJob(doc: PrintJobDoc): Promise<void>;
	/**
	 * Full doc `_id` (`print_job:{ulid}`); null when missing. Needed only to settle a
	 * `PrintJobConflictError` for a client-minted id (a retried create).
	 */
	get?(id: string): Promise<PrintJobDoc | null>;
}

/** The store refused `createJob` because the `_id` is taken (a retried create, or a clash). */
export class PrintJobConflictError extends Error {
	constructor() {
		super('Print job id already exists');
		this.name = 'PrintJobConflictError';
	}
}

/** A client-minted job id is already used by a job of another staff member / printer / request. */
export class PrintJobIdConflictError extends Error {
	constructor() {
		super('Print job id is already in use');
		this.name = 'PrintJobIdConflictError';
	}
}

export interface PrintDeviceReader {
	/** `printerId` is the device doc `_id` (`print_device:{device_id}`); null when missing. */
	getDevice(printerId: string): Promise<PrintDeviceDoc | null>;
}

export interface PrintJobCaller {
	/** `_users` name of the logged-in staff member. */
	name: string;
	/** `_session` roles; decide (with the job source) whether they may print on the shelter. */
	roles: readonly string[];
}

export interface CreatePrintJobDeps {
	/** Built only after the device lookup: the job DB is the device's shelter, as the caller. */
	storeFor: (shelterCode: string) => PrintJobCreator;
	devices: PrintDeviceReader;
	newId?: () => string;
	/**
	 * Recreate `printing_{code}` (ignoring any per-process memo). Called once when the write finds
	 * the DB missing, e.g. dropped by another process; without it that failure surfaces as a 503.
	 */
	reprovisionShelterDb?: (shelterCode: string) => Promise<void>;
}

export class PrinterNotFoundError extends Error {
	constructor() {
		super('Printer not found');
		this.name = 'PrinterNotFoundError';
	}
}

export class PrinterOfflineError extends Error {
	constructor() {
		super('Printer is offline');
		this.name = 'PrinterOfflineError';
	}
}

function toAttachments(labels: readonly string[]): NonNullable<PrintJobDoc['_attachments']> {
	return Object.fromEntries(
		labels.map((data, index) => [
			`label-${String(index).padStart(3, '0')}.png`,
			{ content_type: 'image/png', data }
		])
	);
}

async function writeJob(
	deps: CreatePrintJobDeps,
	shelterCode: string,
	job: PrintJobDoc
): Promise<void> {
	try {
		await deps.storeFor(shelterCode).createJob(job);
	} catch (error) {
		if (!(error instanceof PrintShelterDbMissingError) || !deps.reprovisionShelterDb) throw error;
		// The DB may be gone because the shelter was closed while this request was in flight: only
		// bring it back when the printer is still active, never resurrect a closed shelter's DB.
		const device = await deps.devices.getDevice(job.printer_id);
		if (!device || device.status !== 'active') throw new PrinterNotFoundError();
		await deps.reprovisionShelterDb(shelterCode);
		await deps.storeFor(shelterCode).createJob(job);
	}
}

type RequestKey = Pick<
	PrintJobDoc,
	'created_by' | 'shelter_code' | 'printer_id' | 'source' | 'label_count'
>;

/** True when `existing` is the job this very request wrote earlier (same caller and context). */
function isSameRequest(existing: PrintJobDoc, job: RequestKey): boolean {
	return (
		existing.created_by === job.created_by &&
		existing.shelter_code === job.shelter_code &&
		existing.printer_id === job.printer_id &&
		existing.source === job.source &&
		existing.label_count === job.label_count
	);
}

/**
 * The job this request already wrote under `jobId`, or null when that id holds no job.
 * Throws `PrintJobIdConflictError` when the id belongs to another job.
 */
async function findOwnJob(
	deps: CreatePrintJobDeps,
	jobId: string,
	request: RequestKey
): Promise<{ job_id: string; shelter_code: string; expires_at: string } | null> {
	const existing = await deps.storeFor(request.shelter_code).get?.(`print_job:${jobId}`);
	if (!existing) return null;
	if (!isSameRequest(existing, request)) throw new PrintJobIdConflictError();
	return { job_id: jobId, shelter_code: request.shelter_code, expires_at: existing.expires_at };
}

/**
 * Queue a print job: a `pending` doc with the label PNGs attached, expiring after 120 s.
 * With a client-minted `job_id` the create is idempotent: when that id already holds this same
 * caller's job for the same printer/source/label count (a retry after a lost response), the
 * existing job is returned instead of queueing a second one, even when the printer has gone
 * offline since (a follow-up must learn the job's outcome, not a refusal).
 */
export async function createPrintJob(
	deps: CreatePrintJobDeps,
	caller: PrintJobCaller,
	input: Omit<PrintJobCreateInput, 'source'> & { source: PrintJobDoc['source'] },
	now: Date
): Promise<{ job_id: string; shelter_code: string; expires_at: string }> {
	const device = await deps.devices.getDevice(input.printer_id);
	if (!device || device.status !== 'active') throw new PrinterNotFoundError();
	if (!canPrintSource(caller.roles, device.shelter_code, input.source)) {
		throw new ServiceError('FORBIDDEN', 'Not allowed to print on this shelter');
	}
	if (!isPrinterOnline(device, now)) {
		// A follow-up of a job already written still gets that job, so the tablet learns its outcome
		// instead of a refusal that hides whether the labels printed (FR-47).
		const existing = input.job_id
			? await findOwnJob(deps, input.job_id, {
					created_by: caller.name,
					shelter_code: device.shelter_code,
					printer_id: device._id,
					source: input.source,
					label_count: input.labels.length
				})
			: null;
		if (existing) return existing;
		throw new PrinterOfflineError();
	}

	const jobId = input.job_id ?? (deps.newId ?? ulid)();
	const expiresAt = new Date(now.getTime() + JOB_TTL_SEC * 1000).toISOString();
	const job: PrintJobDoc = {
		_id: `print_job:${jobId}`,
		type: 'print_job',
		schema_v: 1,
		shelter_code: device.shelter_code,
		printer_id: device._id,
		status: 'pending',
		label_count: input.labels.length,
		source: input.source,
		created_at: now.toISOString(),
		created_by: caller.name,
		expires_at: expiresAt,
		claimed_at: null,
		lease_until: null,
		finished_at: null,
		printed: 0,
		error_code: null,
		_attachments: toAttachments(input.labels)
	};
	try {
		await writeJob(deps, device.shelter_code, job);
	} catch (error) {
		if (!(error instanceof PrintJobConflictError)) throw error;
		const existing = await findOwnJob(deps, jobId, job);
		if (!existing) throw new PrintDependencyError();
		return existing;
	}
	return { job_id: jobId, shelter_code: device.shelter_code, expires_at: expiresAt };
}

export class PrintJobNotFoundError extends Error {
	constructor() {
		super('Print job not found');
		this.name = 'PrintJobNotFoundError';
	}
}

export class PrintJobForbiddenError extends Error {
	constructor() {
		super('Print job belongs to another staff member');
		this.name = 'PrintJobForbiddenError';
	}
}

export interface PrintJobReader {
	/** Full doc `_id` (`print_job:{ulid}`); null when missing. */
	get(id: string): Promise<PrintJobDoc | null>;
}

export interface PrintJobStatusView {
	status: PrintJobDoc['status'];
	printed: number;
	label_count: number;
	error_code: string | null;
}

/** Poll target for the tablet: only the job's creator (or SA) may read it. */
export async function getPrintJobStatus(
	store: PrintJobReader,
	caller: { name: string; isSA: boolean },
	jobId: string
): Promise<PrintJobStatusView> {
	const doc = await store.get(`print_job:${jobId}`);
	if (!doc) throw new PrintJobNotFoundError();
	if (!caller.isSA && doc.created_by !== caller.name) throw new PrintJobForbiddenError();
	return {
		status: doc.status,
		printed: doc.printed,
		label_count: doc.label_count,
		error_code: doc.error_code
	};
}

export interface PrintDeviceLister {
	/** Device docs (any status) registered to the shelter. */
	listDevices(shelterCode: string): Promise<PrintDeviceDoc[]>;
}

export interface ShelterPrinterView {
	id: string;
	name: string;
	station: string | null;
	online: boolean;
	queue_state: PrintDeviceDoc['queue_state'];
	last_seen_at: string | null;
}

/** Printers a tablet may pick: active ones of the shelter, by name; secrets never leave the server. */
export async function listShelterPrinters(
	devices: PrintDeviceLister,
	shelterCode: string,
	now: Date
): Promise<ShelterPrinterView[]> {
	const docs = await devices.listDevices(shelterCode);
	return docs
		.filter((doc) => doc.status === 'active' && doc.shelter_code === shelterCode)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((doc) => ({
			id: doc._id,
			name: doc.name,
			station: doc.station,
			online: isPrinterOnline(doc, now),
			queue_state: doc.queue_state,
			last_seen_at: doc.last_seen_at
		}));
}
