import { adminRaw } from '$lib/server/couch-admin';
import {
	PrintDependencyError,
	type PrintDeviceDoc,
	type PrintDeviceLookup
} from './device-credentials';
import type { PrintDeviceWriteResult, PrintDeviceWriter } from './device-heartbeat';
import type {
	PrintDeviceAdminStore,
	PrintDeviceScopeLister,
	PrintJobLastReader
} from './printer-admin.server';
import type { PrintDeviceLister, PrintDeviceReader, PrintJobCreator } from './print-jobs.server';
import type { PrintJobDoc, PrintJobPutResult, PrintJobStore } from './print-queue.server';

/**
 * CouchDB adapters for DB `printing` (central only, admin credential — never reachable from the
 * browser). Intentionally not unit-tested: verified on real hardware (Phase 0, P1–P11).
 */
const DB = '/printing';

/** Admin-only (browsers never read this DB) and a low revision limit: heartbeats rewrite devices often. */
const PRINTING_SECURITY = {
	admins: { roles: ['_admin'] },
	members: { roles: ['_admin'] }
};
const PRINTING_REVS_LIMIT = 100;
const PRINTING_INDEXES: ReadonlyArray<{ name: string; fields: string[] }> = [
	{ name: 'print-job-printer-status-created', fields: ['printer_id', 'status', 'created_at'] },
	{ name: 'print-job-printer-created', fields: ['printer_id', 'created_at'] },
	{ name: 'print-job-status-finished', fields: ['status', 'finished_at'] },
	{ name: 'print-job-status-lease', fields: ['status', 'lease_until'] }
];

let ensured: Promise<void> | null = null;

async function ensurePrintingDb(): Promise<void> {
	// 201/202 created, 412 already exists.
	const created = await adminRaw(DB, 'PUT');
	if (![201, 202, 412].includes(created.status)) throw new PrintDependencyError();

	const security = await adminRaw(`${DB}/_security`, 'PUT', PRINTING_SECURITY);
	if (security.status !== 200) throw new PrintDependencyError();

	const revs = await adminRaw(`${DB}/_revs_limit`, 'PUT', PRINTING_REVS_LIMIT);
	if (revs.status !== 200) throw new PrintDependencyError();

	for (const { name, fields } of PRINTING_INDEXES) {
		const index = await adminRaw(`${DB}/_index`, 'POST', {
			index: { fields },
			name,
			type: 'json'
		});
		if (index.status !== 200) throw new PrintDependencyError();
	}
}

/** Create DB `printing` + security + indexes exactly once per process; retried after a failure. */
export function ensurePrintingDbOnce(): Promise<void> {
	ensured ??= ensurePrintingDb().catch((error: unknown) => {
		ensured = null;
		throw error;
	});
	return ensured;
}

async function find<T>(selector: Record<string, unknown>, limit: number): Promise<T[]> {
	await ensurePrintingDbOnce();
	const { status, data } = await adminRaw(`${DB}/_find`, 'POST', { selector, limit });
	if (status !== 200) throw new PrintDependencyError();
	return (data as { docs: T[] }).docs;
}

export const printDeviceRepository: PrintDeviceLookup &
	PrintDeviceWriter &
	PrintDeviceReader &
	PrintDeviceLister &
	PrintDeviceAdminStore &
	PrintDeviceScopeLister = {
	async createDevice(doc) {
		await ensurePrintingDbOnce();
		const { status, data } = await adminRaw(`${DB}/${encodeURIComponent(doc._id)}`, 'PUT', doc);
		if (status === 409) return { conflict: true };
		if (status !== 201 && status !== 202) throw new PrintDependencyError();
		return { ok: true, rev: (data as { rev: string }).rev };
	},

	async getDeviceByDeviceId(deviceId) {
		const docs = await find<PrintDeviceDoc>({ type: 'print_device', device_id: deviceId }, 1);
		return docs[0] ?? null;
	},

	async getDevice(printerId) {
		await ensurePrintingDbOnce();
		const { status, data } = await adminRaw(`${DB}/${encodeURIComponent(printerId)}`, 'GET');
		if (status === 404) return null;
		if (status !== 200) throw new PrintDependencyError();
		return data as PrintDeviceDoc;
	},

	listDevices(shelterCode) {
		return find<PrintDeviceDoc>({ type: 'print_device', shelter_code: shelterCode }, 100);
	},

	async deleteDevice(doc) {
		await ensurePrintingDbOnce();
		const { status } = await adminRaw(
			`${DB}/${encodeURIComponent(doc._id)}?rev=${encodeURIComponent(doc._rev ?? '')}`,
			'DELETE'
		);
		if (status === 409) return { conflict: true };
		if (status === 404) return { ok: true };
		if (status !== 200 && status !== 202) throw new PrintDependencyError();
		return { ok: true };
	},

	listDevicesInScope(scope) {
		return find<PrintDeviceDoc>(
			{ type: 'print_device', ...(scope === null ? {} : { shelter_code: { $in: scope } }) },
			1000
		);
	},

	async updateDevice(doc): Promise<PrintDeviceWriteResult> {
		await ensurePrintingDbOnce();
		const { status, data } = await adminRaw(`${DB}/${encodeURIComponent(doc._id)}`, 'PUT', doc);
		if (status === 409) return { conflict: true };
		if (status !== 201 && status !== 202) throw new PrintDependencyError();
		return { ok: true, rev: (data as { rev: string }).rev };
	}
};

export const printJobStore: PrintJobStore & PrintJobCreator & PrintJobLastReader = {
	findJobs({ status, printerId }) {
		return find<PrintJobDoc>(
			{ type: 'print_job', status, ...(printerId !== undefined ? { printer_id: printerId } : {}) },
			100
		);
	},

	async get(id) {
		await ensurePrintingDbOnce();
		const { status, data } = await adminRaw(`${DB}/${encodeURIComponent(id)}`, 'GET');
		if (status === 404) return null;
		if (status !== 200) throw new PrintDependencyError();
		return data as PrintJobDoc;
	},

	/** Back-office list: newest job of a printer. Served by the `print-job-printer-created` index. */
	async lastJobOf(printerId) {
		await ensurePrintingDbOnce();
		const { status, data } = await adminRaw(`${DB}/_find`, 'POST', {
			selector: { type: 'print_job', printer_id: printerId, created_at: { $gt: null } },
			sort: [{ printer_id: 'desc' }, { created_at: 'desc' }],
			limit: 1,
			fields: ['_id', 'status', 'finished_at', 'error_code', 'created_at', 'printer_id']
		});
		if (status !== 200) throw new PrintDependencyError();
		return ((data as { docs: PrintJobDoc[] }).docs[0] as PrintJobDoc | undefined) ?? null;
	},

	async createJob(doc) {
		await ensurePrintingDbOnce();
		const { status } = await adminRaw(`${DB}/${encodeURIComponent(doc._id)}`, 'PUT', doc);
		if (status !== 201 && status !== 202) throw new PrintDependencyError();
	},

	async put(doc): Promise<PrintJobPutResult> {
		await ensurePrintingDbOnce();
		const { status, data } = await adminRaw(`${DB}/${encodeURIComponent(doc._id)}`, 'PUT', doc);
		if (status === 409) return { conflict: true };
		if (status !== 201 && status !== 202) throw new PrintDependencyError();
		return { ok: true, rev: (data as { rev: string }).rev };
	},

	async pendingCursor() {
		await ensurePrintingDbOnce();
		const { status, data } = await adminRaw(DB, 'GET');
		if (status !== 200) throw new PrintDependencyError();
		return String((data as { update_seq: string | number }).update_seq);
	},

	async waitForPending(printerId, since, { timeoutMs, signal }) {
		await ensurePrintingDbOnce();
		const query = new URLSearchParams({
			feed: 'longpoll',
			filter: '_selector',
			since,
			timeout: String(Math.max(0, Math.floor(timeoutMs)))
		});
		try {
			const { status } = await adminRaw(
				`${DB}/_changes?${query}`,
				'POST',
				{ selector: { type: 'print_job', printer_id: printerId, status: 'pending' } },
				signal
			);
			if (status !== 200) throw new PrintDependencyError();
		} catch (error) {
			// Client hung up: the caller checks `signal.aborted` and stops.
			if (signal.aborted) return;
			throw error;
		}
	},

	async getLabels(jobId) {
		await ensurePrintingDbOnce();
		const { status, data } = await adminRaw(
			`${DB}/${encodeURIComponent(jobId)}?attachments=true`,
			'GET'
		);
		if (status !== 200) throw new PrintDependencyError();
		const attachments = (data as { _attachments?: Record<string, { data: string }> })._attachments;
		return Object.entries(attachments ?? {})
			.filter(([name]) => /^label-\d+\.png$/.test(name))
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, attachment]) => attachment.data);
	}
};
