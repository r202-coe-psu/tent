import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel will pull client UI/query code
import { isPrinterOnline } from '$lib/features/printers/domain/printer-status';
import { generatePrintSecret, hashPrintSecret, type PrintDeviceDoc } from './device-credentials';
import type { PrintDeviceWriteResult } from './device-heartbeat';
import { createPrintJob, type PrintDeviceReader, type PrintJobCreator } from './print-jobs.server';
import {
	terminal,
	type PrintJobDoc,
	type PrintJobPutResult,
	type PrintJobStatus
} from './print-queue.server';
import { TEST_LABEL_PNG_BASE64 } from './test-label';

/** Back-office printer management (plan §4.3): registry CRUD over `print_device` docs. */

export const printDeviceInputSchema = z
	.object({
		device_id: z
			.string()
			.regex(/^[a-z0-9][a-z0-9-]{2,62}$/, 'Device ID must match [a-z0-9-]{3,63}'),
		name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
		shelter_code: shelterCodeSchema,
		station: z.string().trim().nullish(),
		host_kind: z.enum(['standalone', 'kiosk'])
	})
	.strict();
export type PrintDeviceInput = z.infer<typeof printDeviceInputSchema>;

export interface PrinterSummary {
	id: string;
	device_id: string;
	name: string;
	shelter_code: string;
	station: string | null;
	host_kind: PrintDeviceDoc['host_kind'];
	status: PrintDeviceDoc['status'];
	secret_prefix: string;
	last_seen_at: string | null;
	queue_state: PrintDeviceDoc['queue_state'];
	agent_version: string | null;
	online: boolean;
}

export type PrintDeviceCreateResult = { ok: true; rev: string } | { conflict: true };

/** Registry port over the `printing` DB; the real adapter is `printDeviceRepository`. */
export interface PrintDeviceAdminStore {
	createDevice(doc: PrintDeviceDoc): Promise<PrintDeviceCreateResult>;
	getDevice(printerId: string): Promise<PrintDeviceDoc | null>;
	updateDevice(doc: PrintDeviceDoc): Promise<PrintDeviceWriteResult>;
	/** Delete at `doc._rev`; a conflict means the doc changed (e.g. a heartbeat) since it was read. */
	deleteDevice(doc: PrintDeviceDoc): Promise<{ ok: true } | { conflict: true }>;
}

export class PrintDeviceConflictError extends Error {
	constructor(message = 'Device ID already exists') {
		super(message);
		this.name = 'PrintDeviceConflictError';
	}
}

export class PrintDeviceNotFoundError extends Error {
	constructor() {
		super('Printer not found');
		this.name = 'PrintDeviceNotFoundError';
	}
}

export const printDevicePatchSchema = z
	.object({
		name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long').optional(),
		station: z.string().trim().nullable().optional(),
		status: z.enum(['active', 'inactive']).optional()
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type PrintDevicePatch = z.infer<typeof printDevicePatchSchema>;

export function toPrinterSummary(doc: PrintDeviceDoc, now: Date): PrinterSummary {
	return {
		id: doc._id,
		device_id: doc.device_id,
		name: doc.name,
		shelter_code: doc.shelter_code,
		station: doc.station,
		host_kind: doc.host_kind,
		status: doc.status,
		secret_prefix: doc.secret_prefix,
		last_seen_at: doc.last_seen_at,
		queue_state: doc.queue_state,
		agent_version: doc.agent_version,
		online: isPrinterOnline(doc, now)
	};
}

const SECRET_PREFIX_LENGTH = 16;

/** Register a printer; the plaintext secret is returned here and never stored (hash + prefix only). */
export async function createPrinter(
	store: PrintDeviceAdminStore,
	input: PrintDeviceInput,
	actor: string,
	now: Date
): Promise<{ device: PrinterSummary; secret: string }> {
	const secret = generatePrintSecret();
	const iso = now.toISOString();
	const doc: PrintDeviceDoc = {
		_id: `print_device:${input.device_id}`,
		type: 'print_device',
		schema_v: 1,
		device_id: input.device_id,
		name: input.name,
		shelter_code: input.shelter_code,
		station: input.station || null,
		host_kind: input.host_kind,
		secret_hash: hashPrintSecret(secret),
		secret_prefix: secret.slice(0, SECRET_PREFIX_LENGTH),
		status: 'active',
		last_seen_at: null,
		queue_state: 'unknown',
		agent_version: null,
		created_at: iso,
		updated_at: iso,
		created_by: actor
	};
	if ('conflict' in (await store.createDevice(doc))) throw new PrintDeviceConflictError();
	return { device: toPrinterSummary(doc, now), secret };
}

export interface PrinterLastJob {
	status: PrintJobDoc['status'];
	finished_at: string | null;
	error_code: string | null;
	created_at: string;
}

export interface PrinterListItem extends PrinterSummary {
	last_job: PrinterLastJob | null;
}

export interface PrintDeviceScopeLister {
	/** Devices of any status in these shelters; `null` = every shelter. */
	listDevicesInScope(scope: string[] | null): Promise<PrintDeviceDoc[]>;
}

export interface PrintJobLastReader {
	/** Newest job (any status) of a printer by `created_at`; null when it never printed. */
	lastJobOf(printerId: string): Promise<PrintJobDoc | null>;
}

export interface PrinterListDeps {
	devices: PrintDeviceScopeLister;
	jobs: PrintJobLastReader;
}

export async function listPrinters(
	deps: PrinterListDeps,
	scope: string[] | null,
	now: Date
): Promise<{ printers: PrinterListItem[]; server_time: string }> {
	const docs = await deps.devices.listDevicesInScope(scope);
	const sorted = [...docs].sort(
		(a, b) => a.shelter_code.localeCompare(b.shelter_code) || a.name.localeCompare(b.name)
	);
	const printers = await Promise.all(
		sorted.map(async (doc): Promise<PrinterListItem> => {
			const job = await deps.jobs.lastJobOf(doc._id);
			return {
				...toPrinterSummary(doc, now),
				last_job: job && {
					status: job.status,
					finished_at: job.finished_at,
					error_code: job.error_code,
					created_at: job.created_at
				}
			};
		})
	);
	return { printers, server_time: now.toISOString() };
}

const MAX_WRITE_ATTEMPTS = 4;

/**
 * Read-modify-write one device doc. Heartbeats rewrite the doc every ~20 s, so a `_rev` conflict is
 * normal: re-read (keeping the fresh heartbeat fields) and re-apply the change.
 */
async function mutateDevice(
	store: PrintDeviceAdminStore,
	printerId: string,
	now: Date,
	change: (doc: PrintDeviceDoc) => PrintDeviceDoc
): Promise<PrintDeviceDoc> {
	for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
		const current = await store.getDevice(printerId);
		if (!current) throw new PrintDeviceNotFoundError();
		const next = { ...change(current), updated_at: now.toISOString() };
		if (!('conflict' in (await store.updateDevice(next)))) return next;
	}
	throw new PrintDeviceConflictError('Printer was modified concurrently');
}

/** Job slice the admin use cases need to close a printer's open jobs. */
export interface PrinterJobCloser {
	findJobs(query: { status: PrintJobStatus; printerId?: string }): Promise<PrintJobDoc[]>;
	put(doc: PrintJobDoc): Promise<PrintJobPutResult>;
}

/** Fail the printer's pending/printing jobs with `errorCode`; the terminal PUT drops the labels. */
async function failOpenJobs(
	jobs: PrinterJobCloser,
	printerId: string,
	errorCode: 'printer_deleted' | 'printer_inactive',
	now: Date
): Promise<void> {
	for (const status of ['pending', 'printing'] as const) {
		for (const job of await jobs.findJobs({ status, printerId })) {
			// A conflict means the job just moved on (claimed/finished); the lease sweeper settles it.
			await jobs.put(terminal(job, 'failed', now, { error_code: errorCode }));
		}
	}
}

export interface UpdatePrinterDeps {
	devices: PrintDeviceAdminStore;
	jobs: PrinterJobCloser;
}

/**
 * Deactivating also fails the printer's open jobs (`printer_inactive`). The device is written
 * inactive first, so no new job can be queued or claimed while they are being closed.
 */
export async function updatePrinter(
	deps: UpdatePrinterDeps,
	printerId: string,
	patch: PrintDevicePatch,
	now: Date
): Promise<PrinterSummary> {
	const doc = await mutateDevice(deps.devices, printerId, now, (current) => ({
		...current,
		...(patch.name !== undefined ? { name: patch.name } : {}),
		...(patch.station !== undefined ? { station: patch.station || null } : {}),
		...(patch.status !== undefined ? { status: patch.status } : {})
	}));
	if (patch.status === 'inactive')
		await failOpenJobs(deps.jobs, printerId, 'printer_inactive', now);
	return toPrinterSummary(doc, now);
}

export async function rotatePrinterSecret(
	store: PrintDeviceAdminStore,
	printerId: string,
	now: Date
): Promise<{ device: PrinterSummary; secret: string }> {
	const secret = generatePrintSecret();
	const doc = await mutateDevice(store, printerId, now, (current) => ({
		...current,
		secret_hash: hashPrintSecret(secret),
		secret_prefix: secret.slice(0, SECRET_PREFIX_LENGTH)
	}));
	return { device: toPrinterSummary(doc, now), secret };
}

export interface TestPrintDeps {
	store: PrintJobCreator;
	devices: PrintDeviceReader;
	newId?: () => string;
}

/** Queue a 1-label test job (built-in label, no personal data) on the printer. */
export function queueTestPrint(
	deps: TestPrintDeps,
	printerId: string,
	actor: string,
	now: Date
): Promise<{ job_id: string; expires_at: string }> {
	return createPrintJob(
		deps,
		{ name: actor, assertShelterAccess: async () => {} }, // the route already checked the scope
		{ printer_id: printerId, source: 'test', labels: [TEST_LABEL_PNG_BASE64] },
		now
	);
}

export type DeletePrinterDeps = UpdatePrinterDeps;

/** Fail the printer's pending/printing jobs (`printer_deleted`, labels dropped), then delete it. */
export async function deletePrinter(
	deps: DeletePrinterDeps,
	printerId: string,
	now: Date
): Promise<void> {
	if (!(await deps.devices.getDevice(printerId))) throw new PrintDeviceNotFoundError();

	await failOpenJobs(deps.jobs, printerId, 'printer_deleted', now);

	for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
		const current = await deps.devices.getDevice(printerId);
		if (!current) return;
		if (!('conflict' in (await deps.devices.deleteDevice(current)))) return;
	}
	throw new PrintDeviceConflictError('Printer was modified concurrently');
}
