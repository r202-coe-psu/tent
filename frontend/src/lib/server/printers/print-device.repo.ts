import { printingRaw } from '$lib/server/couch-printing-service';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel pulls client UI/query code
import { PRINTING_DEVICES_DB } from '$lib/features/printers/domain/printing-db';
import {
	PrintDependencyError,
	type PrintDeviceDoc,
	type PrintDeviceLookup
} from './device-credentials';
import type { PrintDeviceWriteResult, PrintDeviceWriter } from './device-heartbeat';
import type { PrintDeviceAdminStore, PrintDeviceScopeLister } from './printer-admin.server';
import type { PrintDeviceLister, PrintDeviceReader } from './print-jobs.server';
import { ensurePrintingDevicesDb } from './printing-provision';

/**
 * CouchDB adapters for DB `printing_devices` (devices, shelter registry, housekeeping state),
 * reached as `printing_service` — never the server admin. The DB is provisioned by
 * `printing-provision`; every entry point awaits that (memoised there) first.
 */
const DB = `/${PRINTING_DEVICES_DB}`;

const REGISTRY_PREFIX = 'printing_db:';
const HOUSEKEEPING_ID = 'print_housekeeping';

/** Mango only picks a json index when the selector names every field of it. */
const ANY = { $gt: null };

async function find<T>(selector: Record<string, unknown>, limit: number): Promise<T[]> {
	await ensurePrintingDevicesDb();
	const { status, data } = await printingRaw(`${DB}/_find`, 'POST', { selector, limit });
	if (status !== 200) throw new PrintDependencyError();
	return (data as { docs: T[] }).docs;
}

async function putDevice(doc: PrintDeviceDoc): Promise<PrintDeviceWriteResult> {
	await ensurePrintingDevicesDb();
	const { status, data } = await printingRaw(`${DB}/${encodeURIComponent(doc._id)}`, 'PUT', doc);
	if (status === 409) return { conflict: true };
	if (status !== 201 && status !== 202) throw new PrintDependencyError();
	return { ok: true, rev: (data as { rev: string }).rev };
}

export const printDeviceRepository: PrintDeviceLookup &
	PrintDeviceWriter &
	PrintDeviceReader &
	PrintDeviceLister &
	PrintDeviceAdminStore &
	PrintDeviceScopeLister = {
	createDevice: putDevice,

	/** `_id` is deterministic (`print_device:{device_id}`), so auth is a plain GET, not a `_find`. */
	getDeviceByDeviceId(deviceId) {
		return printDeviceRepository.getDevice(`print_device:${deviceId}`);
	},

	async getDevice(printerId) {
		await ensurePrintingDevicesDb();
		const { status, data } = await printingRaw(`${DB}/${encodeURIComponent(printerId)}`, 'GET');
		if (status === 404) return null;
		if (status !== 200) throw new PrintDependencyError();
		return data as PrintDeviceDoc;
	},

	listDevices(shelterCode) {
		return find<PrintDeviceDoc>({ type: 'print_device', shelter_code: shelterCode }, 100);
	},

	async deleteDevice(doc) {
		await ensurePrintingDevicesDb();
		const { status } = await printingRaw(
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
			{ type: 'print_device', shelter_code: scope === null ? ANY : { $in: scope } },
			1000
		);
	},

	updateDevice: putDevice
};

/** Upper-case shelter codes that have a provisioned `printing_{code}` DB (registry docs). */
export async function listRegisteredShelters(): Promise<string[]> {
	await ensurePrintingDevicesDb();
	const query = new URLSearchParams({
		startkey: JSON.stringify(REGISTRY_PREFIX),
		endkey: JSON.stringify(`${REGISTRY_PREFIX}￰`)
	});
	const { status, data } = await printingRaw(`${DB}/_all_docs?${query}`, 'GET');
	if (status !== 200) throw new PrintDependencyError();
	return (data as { rows: { id: string }[] }).rows.map((row) =>
		row.id.slice(REGISTRY_PREFIX.length).toUpperCase()
	);
}

/** Start `_compact` on `printing_devices` (heartbeats leave many old revisions behind). */
export async function compactDevicesDb(): Promise<void> {
	await ensurePrintingDevicesDb();
	const { status } = await printingRaw(`${DB}/_compact`, 'POST', {});
	if (status !== 202 && status !== 200) throw new PrintDependencyError();
}

/** Doc `print_housekeeping`: lets any process know when housekeeping/retention last ran. */
export interface PrintHousekeepingState {
	last_run_at: string | null;
	last_retention_at: string | null;
	last_error: string | null;
}

const HOUSEKEEPING_PATH = `${DB}/${HOUSEKEEPING_ID}`;

async function housekeepingDoc(): Promise<(PrintHousekeepingState & { _rev: string }) | null> {
	const { status, data } = await printingRaw(HOUSEKEEPING_PATH, 'GET');
	if (status === 404) return null;
	if (status !== 200) throw new PrintDependencyError();
	return data as PrintHousekeepingState & { _rev: string };
}

/** Stored state, or `null` before housekeeping ever ran. */
export async function readHousekeepingState(): Promise<PrintHousekeepingState | null> {
	await ensurePrintingDevicesDb();
	const doc = await housekeepingDoc();
	if (!doc) return null;
	return {
		last_run_at: doc.last_run_at,
		last_retention_at: doc.last_retention_at,
		last_error: doc.last_error
	};
}

/** Overwrite the state; on a `_rev` conflict (another process wrote) re-read the rev once. */
export async function writeHousekeepingState(state: PrintHousekeepingState): Promise<void> {
	await ensurePrintingDevicesDb();
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const current = await housekeepingDoc();
		const { status } = await printingRaw(HOUSEKEEPING_PATH, 'PUT', {
			_id: HOUSEKEEPING_ID,
			type: 'print_housekeeping',
			schema_v: 1,
			last_run_at: state.last_run_at,
			last_retention_at: state.last_retention_at,
			last_error: state.last_error,
			...(current ? { _rev: current._rev } : {})
		});
		if (status === 201 || status === 202) return;
		if (status !== 409) break;
	}
	throw new PrintDependencyError();
}
