import { ulid } from '$lib/db/ulid';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel will pull client UI/query code
import type { PrintJobCreateInput } from '$lib/features/printers/domain/print-job.schema';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel will pull client UI/query code
import { isPrinterOnline } from '$lib/features/printers/domain/printer-status';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel will pull client UI/query code
import { JOB_TTL_SEC } from '$lib/features/printers/domain/print-job-timing';
import type { PrintDeviceDoc } from './device-credentials';
import type { PrintJobDoc } from './print-queue.server';

/** Write side of the `printing` DB: one PUT, the doc already carries its `_attachments`. */
export interface PrintJobCreator {
	createJob(doc: PrintJobDoc): Promise<void>;
}

export interface PrintDeviceReader {
	/** `printerId` is the device doc `_id` (`print_device:{device_id}`); null when missing. */
	getDevice(printerId: string): Promise<PrintDeviceDoc | null>;
}

export interface PrintJobCaller {
	/** `_users` name of the logged-in staff member. */
	name: string;
	/** Rejects (route: 401/403) unless the caller may act on this shelter. */
	assertShelterAccess(shelterCode: string): Promise<void>;
}

export interface CreatePrintJobDeps {
	store: PrintJobCreator;
	devices: PrintDeviceReader;
	newId?: () => string;
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

/** Queue a print job: a `pending` doc with the label PNGs attached, expiring after 120 s. */
export async function createPrintJob(
	deps: CreatePrintJobDeps,
	caller: PrintJobCaller,
	input: Omit<PrintJobCreateInput, 'source'> & { source: PrintJobDoc['source'] },
	now: Date
): Promise<{ job_id: string; expires_at: string }> {
	const device = await deps.devices.getDevice(input.printer_id);
	if (!device || device.status !== 'active') throw new PrinterNotFoundError();
	await caller.assertShelterAccess(device.shelter_code);
	if (!isPrinterOnline(device, now)) throw new PrinterOfflineError();

	const jobId = (deps.newId ?? ulid)();
	const expiresAt = new Date(now.getTime() + JOB_TTL_SEC * 1000).toISOString();
	await deps.store.createJob({
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
	});
	return { job_id: jobId, expires_at: expiresAt };
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
