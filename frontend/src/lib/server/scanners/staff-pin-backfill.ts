// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import {
	SCANNER_REGISTRY_DB,
	SCANNER_SCHEMA_V,
	scannerDevicePersistedSchema,
	type PersistedScannerDevice,
	type PersistedScannerDeviceV2
} from '$lib/features/scanners/domain/scanner.schema';
import { ScannerConflictError } from './device-credentials';
import {
	generateStaffPin,
	SCANNER_SECRETS_DB,
	StaffPinSecretStore,
	StaffPinUnavailableError,
	type CouchAdminCall
} from './staff-pin-secret';

/** `updated_by` of a default PIN that came from the backfill rather than an SA. */
export const STAFF_PIN_BACKFILL_ACTOR = 'system:sync-central';

const DEVICE_ID_PREFIX = 'scanner_device:';
const SECRET_ID_PREFIX = 'staff_pin:';
const REGISTRY_WRITE_ATTEMPTS = 3;

export type StaffPinBackfillReport = {
	/** Devices given (dry-run: that would be given) a default PIN. Never the PINs themselves. */
	pinned: string[];
	/** Another writer got there first (PIN doc or device doc); left alone — run again to retry. */
	conflicts: string[];
};

export type StaffPinBackfillOptions = {
	dryRun: boolean;
	now?: () => string;
	generate?: () => string;
};

/** Device ids (in order) that have no PIN doc yet. */
export function devicesWithoutStaffPin(
	deviceIds: readonly string[],
	pinnedDeviceIds: ReadonlySet<string>
): string[] {
	return deviceIds.filter((id) => !pinnedDeviceIds.has(id));
}

function rangeQuery(prefix: string): string {
	const key = (value: string) => encodeURIComponent(JSON.stringify(value));
	return `startkey=${key(prefix)}&endkey=${key(`${prefix}￰`)}`;
}

type AllDocsRow = { id: string; doc?: unknown };

async function allDocs(
	call: CouchAdminCall,
	db: string,
	prefix: string,
	includeDocs: boolean
): Promise<AllDocsRow[] | null> {
	const result = await call(
		`/${db}/_all_docs?${rangeQuery(prefix)}${includeDocs ? '&include_docs=true' : ''}`,
		'GET'
	);
	if (result.status === 404) return null;
	const rows = (result.data as { rows?: unknown } | null)?.rows;
	if (result.status !== 200 || !Array.isArray(rows)) {
		throw new StaffPinUnavailableError(`Cannot list ${db} (HTTP ${result.status})`);
	}
	return rows as AllDocsRow[];
}

/** Every scanner device in the registry, by device id. Docs that do not parse are skipped. */
async function listDevices(call: CouchAdminCall): Promise<Map<string, PersistedScannerDevice>> {
	const rows = (await allDocs(call, SCANNER_REGISTRY_DB, DEVICE_ID_PREFIX, true)) ?? [];
	const devices = new Map<string, PersistedScannerDevice>();
	for (const row of rows) {
		const parsed = scannerDevicePersistedSchema.safeParse(row.doc);
		if (parsed.success) devices.set(parsed.data.device_id, parsed.data);
	}
	return devices;
}

async function listPinnedDeviceIds(call: CouchAdminCall): Promise<Set<string>> {
	const rows = (await allDocs(call, SCANNER_SECRETS_DB, SECRET_ID_PREFIX, false)) ?? [];
	return new Set(rows.map((row) => row.id.slice(SECRET_ID_PREFIX.length)));
}

/**
 * Stamp `staff_pin_*` and v2 onto the device doc, re-reading it on a `_rev` conflict (a heartbeat
 * or a browser edit). `false` = still conflicting after a few tries or the device is gone.
 */
async function stampRegistry(
	call: CouchAdminCall,
	initial: PersistedScannerDevice,
	updatedAt: string
): Promise<boolean> {
	const path = `/${SCANNER_REGISTRY_DB}/${encodeURIComponent(`${DEVICE_ID_PREFIX}${initial.device_id}`)}`;
	let current = initial;
	for (let attempt = 1; attempt <= REGISTRY_WRITE_ATTEMPTS; attempt += 1) {
		const updated: PersistedScannerDeviceV2 = {
			...current,
			schema_v: SCANNER_SCHEMA_V,
			updated_at: updatedAt,
			staff_pin_set: true,
			staff_pin_is_default: true,
			staff_pin_updated_at: updatedAt,
			staff_pin_updated_by: STAFF_PIN_BACKFILL_ACTOR
		};
		const put = await call(path, 'PUT', scannerDevicePersistedSchema.parse(updated));
		if (put.status >= 200 && put.status < 300) return true;
		if (put.status !== 409) return false;
		const reread = await call(path, 'GET');
		const parsed = scannerDevicePersistedSchema.safeParse(reread.data);
		if (reread.status !== 200 || !parsed.success) return false;
		current = parsed.data;
	}
	return false;
}

/**
 * Give every registered scanner device that has no staff PIN yet a random default PIN
 * (draft-kiosk-staff-pin-face-bypass FR-13), so existing kiosks can use the staff bypass. Never
 * overwrites a PIN doc; running it again changes nothing. Ensures `scanner_secrets` exists with
 * admin-only `_security` first and refuses to write any PIN otherwise. Never reports a PIN.
 */
export async function backfillStaffPins(
	call: CouchAdminCall,
	options: StaffPinBackfillOptions
): Promise<StaffPinBackfillReport> {
	const now = options.now ?? (() => new Date().toISOString());
	const generate = options.generate ?? generateStaffPin;
	const store = new StaffPinSecretStore(call);

	if (!options.dryRun) await store.ensureDatabase();

	const devices = await listDevices(call);
	const pending = devicesWithoutStaffPin([...devices.keys()], await listPinnedDeviceIds(call));
	if (options.dryRun) return { pinned: pending, conflicts: [] };

	const report: StaffPinBackfillReport = { pinned: [], conflicts: [] };
	for (const deviceId of pending) {
		const device = devices.get(deviceId);
		if (!device) continue;
		const updatedAt = now();
		let saved;
		try {
			saved = await store.put(
				{
					device_id: deviceId,
					pin: generate(),
					is_default: true,
					updated_at: updatedAt,
					updated_by: STAFF_PIN_BACKFILL_ACTOR
				},
				null
			);
		} catch (error) {
			if (!(error instanceof ScannerConflictError)) throw error;
			report.conflicts.push(deviceId);
			continue;
		}
		if (await stampRegistry(call, device, updatedAt)) {
			report.pinned.push(deviceId);
		} else {
			// Only this run's doc goes: a newer one (an SA set the PIN meanwhile) is left alone.
			await store.remove(deviceId, saved._rev).catch(() => undefined);
			report.conflicts.push(deviceId);
		}
	}
	return report;
}
