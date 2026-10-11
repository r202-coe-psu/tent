// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import {
	SCANNER_REGISTRY_DB,
	SCANNER_SCHEMA_V,
	scannerDevicePersistedSchema,
	staffPinStateOf,
	type PersistedScannerDevice,
	type PersistedScannerDeviceV2
} from '$lib/features/scanners/domain/scanner.schema';
import { ScannerConflictError } from './device-credentials';
import {
	generateStaffPin,
	SCANNER_SECRETS_DB,
	StaffPinSecretStore,
	staffPinSecretSchema,
	StaffPinUnavailableError,
	type CouchAdminCall,
	type StaffPinSecret
} from './staff-pin-secret';

/** `updated_by` of a default PIN that came from the backfill rather than an SA. */
export const STAFF_PIN_BACKFILL_ACTOR = 'system:sync-central';

const DEVICE_ID_PREFIX = 'scanner_device:';
const SECRET_ID_PREFIX = 'staff_pin:';
const REGISTRY_WRITE_ATTEMPTS = 3;

export type StaffPinBackfillReport = {
	/** Devices given (dry-run: that would be given) a default PIN. Never the PINs themselves. */
	pinned: string[];
	/**
	 * Devices whose registry `staff_pin_*` (or v1 shape) disagreed with their PIN doc and were
	 * (dry-run: would be) stamped from it. The PIN doc is never changed.
	 */
	reconciled: string[];
	/** PIN docs with no scanner device (inert, FR-12). Reported only, never deleted. */
	orphans: string[];
	/** Another writer got there first (PIN doc or device doc); left alone — run again to retry. */
	conflicts: string[];
};

type StaffPinMetadata = Pick<
	PersistedScannerDeviceV2,
	'staff_pin_set' | 'staff_pin_is_default' | 'staff_pin_updated_at' | 'staff_pin_updated_by'
>;

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

/**
 * Every PIN doc, by device id (its `_id` suffix). A doc that does not parse still counts as "has a
 * PIN" (`null`), so it is never overwritten, but it is not used to reconcile the registry.
 */
async function listPinDocs(call: CouchAdminCall): Promise<Map<string, StaffPinSecret | null>> {
	const rows = (await allDocs(call, SCANNER_SECRETS_DB, SECRET_ID_PREFIX, true)) ?? [];
	const docs = new Map<string, StaffPinSecret | null>();
	for (const row of rows) {
		const parsed = staffPinSecretSchema.safeParse(row.doc);
		docs.set(row.id.slice(SECRET_ID_PREFIX.length), parsed.success ? parsed.data : null);
	}
	return docs;
}

function metadataOf(secret: StaffPinSecret): StaffPinMetadata {
	return {
		staff_pin_set: true,
		staff_pin_is_default: secret.is_default,
		staff_pin_updated_at: secret.updated_at,
		staff_pin_updated_by: secret.updated_by
	};
}

/** True when the registry doc is v2 and its `staff_pin_*` match what the PIN doc says. */
function metadataMatches(device: PersistedScannerDevice, secret: StaffPinSecret): boolean {
	if (device.schema_v !== SCANNER_SCHEMA_V) return false;
	const state = staffPinStateOf(device);
	const want = metadataOf(secret);
	return (
		state.staff_pin_set === want.staff_pin_set &&
		state.staff_pin_is_default === want.staff_pin_is_default &&
		state.staff_pin_updated_at === want.staff_pin_updated_at &&
		state.staff_pin_updated_by === want.staff_pin_updated_by
	);
}

/**
 * Stamp `staff_pin_*` and v2 onto the device doc, re-reading it on a `_rev` conflict (a heartbeat
 * or a browser edit). `false` = still conflicting after a few tries or the device is gone.
 */
async function stampRegistry(
	call: CouchAdminCall,
	initial: PersistedScannerDevice,
	metadata: StaffPinMetadata,
	updatedAt: string
): Promise<boolean> {
	const path = `/${SCANNER_REGISTRY_DB}/${encodeURIComponent(`${DEVICE_ID_PREFIX}${initial.device_id}`)}`;
	let current = initial;
	for (let attempt = 1; attempt <= REGISTRY_WRITE_ATTEMPTS; attempt += 1) {
		const updated: PersistedScannerDeviceV2 = {
			...current,
			...metadata,
			schema_v: SCANNER_SCHEMA_V,
			updated_at: updatedAt
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
 * overwrites a PIN doc; running it again changes nothing. Devices that already have a PIN doc get
 * their registry `staff_pin_*` stamped from it when they disagree (the PIN doc is what verify
 * reads); PIN docs with no device are reported, never deleted. Ensures `scanner_secrets` exists
 * with admin-only `_security` first and refuses to write any PIN otherwise. Never reports a PIN.
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
	const pinDocs = await listPinDocs(call);
	const pending = devicesWithoutStaffPin([...devices.keys()], new Set(pinDocs.keys()));
	const orphans = [...pinDocs.keys()].filter((id) => !devices.has(id));
	const stale = [...devices.values()].filter((device) => {
		const secret = pinDocs.get(device.device_id);
		return secret ? !metadataMatches(device, secret) : false;
	});
	if (options.dryRun) {
		return {
			pinned: pending,
			reconciled: stale.map((device) => device.device_id),
			orphans,
			conflicts: []
		};
	}

	const report: StaffPinBackfillReport = { pinned: [], reconciled: [], orphans, conflicts: [] };
	for (const device of stale) {
		const secret = pinDocs.get(device.device_id);
		if (!secret) continue;
		if (await stampRegistry(call, device, metadataOf(secret), now())) {
			report.reconciled.push(device.device_id);
		} else {
			report.conflicts.push(device.device_id);
		}
	}
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
		const metadata: StaffPinMetadata = {
			staff_pin_set: true,
			staff_pin_is_default: true,
			staff_pin_updated_at: updatedAt,
			staff_pin_updated_by: STAFF_PIN_BACKFILL_ACTOR
		};
		if (await stampRegistry(call, device, metadata, updatedAt)) {
			report.pinned.push(deviceId);
		} else {
			// Only this run's doc goes: a newer one (an SA set the PIN meanwhile) is left alone.
			await store.remove(deviceId, saved._rev).catch(() => undefined);
			report.conflicts.push(deviceId);
		}
	}
	return report;
}
