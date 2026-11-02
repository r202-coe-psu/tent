import { adminRaw } from '$lib/server/couch-admin';
import { requirePrintingServiceName } from '$lib/server/couch-printing-service';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel pulls client UI/query code
import { PRINTING_DEVICES_DB, printingDbName } from '$lib/features/printers/domain/printing-db';
import { PrintDependencyError } from './device-credentials';
import { closeShelterPrintingWith, type ShelterCloseReport } from './printing-close';
import {
	updatePrinter,
	type KioskDeviceReader,
	type PrinterJobCloser,
	type PrintDeviceAdminStore
} from './printer-admin.server';
import type { PrintDeviceLister } from './print-jobs.server';
import { buildPrintingValidateDocUpdate } from './printing-vdu';

/**
 * Provisioning of the printing databases (FR-1..4). The ONLY printer module allowed to use the
 * CouchDB server admin (`adminRaw`): everything at runtime goes through `printing_service`.
 *
 * - `printing_devices`: devices + registry docs + housekeeping; only `printing_service` can reach it.
 * - `printing_{code}`: one print-job DB per shelter; `printing_service` plus the shelter's staff
 *   (`shelter:{CODE}`, `system_admin`) may read, and `_design/print_access` limits what they write.
 *
 * `printing_service` here is the CouchDB login of `COUCHDB_PRINTING_SERVICE_URL`
 * ({@link requirePrintingServiceName}); an unknown name fails closed before any request.
 */

const DEVICES_REVS_LIMIT = 10;
const SHELTER_REVS_LIMIT = 100;
const DESIGN_DOC = '_design/print_access';

const DEVICE_INDEXES: ReadonlyArray<{ name: string; fields: string[] }> = [
	{ name: 'print-device-shelter', fields: ['type', 'shelter_code'] },
	{ name: 'print-doc-type', fields: ['type'] }
];

const JOB_INDEXES: ReadonlyArray<{ name: string; fields: string[] }> = [
	{ name: 'print-job-printer-status-created', fields: ['printer_id', 'status', 'created_at'] },
	{ name: 'print-job-printer-created', fields: ['printer_id', 'created_at'] },
	{ name: 'print-job-status-finished', fields: ['status', 'finished_at'] },
	{ name: 'print-job-status-lease', fields: ['status', 'lease_until'] },
	{ name: 'print-job-status-expires', fields: ['status', 'expires_at'] }
];

type Raw = { status: number; data: unknown };

function expectStatus(response: Raw, ...accepted: number[]): Raw {
	if (!accepted.includes(response.status)) throw new PrintDependencyError();
	return response;
}

/** PUT db: 201/202 created, 412 already exists. */
async function putDb(db: string): Promise<void> {
	expectStatus(await adminRaw(`/${db}`, 'PUT'), 201, 202, 412);
}

async function putSettings(db: string, security: unknown, revsLimit: number): Promise<void> {
	expectStatus(await adminRaw(`/${db}/_security`, 'PUT', security), 200);
	expectStatus(await adminRaw(`/${db}/_revs_limit`, 'PUT', revsLimit), 200);
}

async function createIndexes(
	db: string,
	indexes: ReadonlyArray<{ name: string; fields: string[] }>
): Promise<void> {
	for (const { name, fields } of indexes) {
		expectStatus(
			await adminRaw(`/${db}/_index`, 'POST', { index: { fields }, name, type: 'json' }),
			200
		);
	}
}

/** Install `_design/print_access`; rewrites only when the stored VDU differs from the current one. */
async function ensureDesignDoc(db: string, serviceUser: string): Promise<void> {
	const validateDocUpdate = buildPrintingValidateDocUpdate(serviceUser);
	const path = `/${db}/${DESIGN_DOC}`;
	const existing = await adminRaw(path, 'GET');
	if (existing.status !== 200 && existing.status !== 404) throw new PrintDependencyError();

	const current = existing.status === 200 ? (existing.data as Record<string, unknown>) : null;
	if (current?.validate_doc_update === validateDocUpdate) return;

	expectStatus(
		await adminRaw(path, 'PUT', {
			...(current ? { _rev: current._rev } : {}),
			language: 'javascript',
			validate_doc_update: validateDocUpdate
		}),
		201,
		202
	);
}

let devicesDb: Promise<void> | null = null;

async function provisionDevicesDb(): Promise<void> {
	const serviceUser = requirePrintingServiceName();
	await putDb(PRINTING_DEVICES_DB);
	await putSettings(
		PRINTING_DEVICES_DB,
		{
			admins: { names: [serviceUser], roles: [] },
			members: { names: [serviceUser], roles: [] }
		},
		DEVICES_REVS_LIMIT
	);
	await createIndexes(PRINTING_DEVICES_DB, DEVICE_INDEXES);
}

/** Create `printing_devices` + security + indexes once per process; retried after a failure. */
export function ensurePrintingDevicesDb(): Promise<void> {
	devicesDb ??= provisionDevicesDb().catch((error: unknown) => {
		devicesDb = null;
		throw error;
	});
	return devicesDb;
}

const shelterDbs = new Map<string, Promise<void>>();

async function provisionShelterDb(code: string, db: string): Promise<void> {
	const serviceUser = requirePrintingServiceName();
	await putDb(db);
	await putSettings(
		db,
		{
			admins: { names: [serviceUser], roles: [] },
			members: { names: [serviceUser], roles: [`shelter:${code}`, 'system_admin'] }
		},
		SHELTER_REVS_LIMIT
	);
	await ensureDesignDoc(db, serviceUser);
	await createIndexes(db, JOB_INDEXES);

	await ensurePrintingDevicesDb();
	const id = `printing_db:${code}`;
	expectStatus(
		await adminRaw(`/${PRINTING_DEVICES_DB}/${encodeURIComponent(id)}`, 'PUT', {
			_id: id,
			type: 'printing_db',
			schema_v: 1,
			shelter_code: code,
			created_at: new Date().toISOString()
		}),
		201,
		202,
		409
	);
}

/**
 * Provision `printing_{code}` (db, security, revs limit, `print_access` VDU, job indexes) and
 * register it in `printing_devices`. Idempotent and memoized per code; retried after a failure.
 * Throws for a code that cannot form a database name, before any request.
 */
export async function ensureShelterPrintingDb(shelterCode: string): Promise<void> {
	const db = printingDbName(shelterCode);
	const code = shelterCode.toUpperCase();
	let provisioned = shelterDbs.get(code);
	if (!provisioned) {
		provisioned = provisionShelterDb(code, db).catch((error: unknown) => {
			shelterDbs.delete(code);
			throw error;
		});
		shelterDbs.set(code, provisioned);
	}
	return provisioned;
}

/**
 * Provision `printing_{code}` again, ignoring the per-process memo. The memo goes stale when
 * another process (`scripts/close-shelter-printing.ts`) drops the DB, so a request that finds it
 * missing, a new printer, or a printer reactivation calls this instead of {@link ensureShelterPrintingDb}.
 */
export function reprovisionShelterPrintingDb(shelterCode: string): Promise<void> {
	printingDbName(shelterCode); // throws for an invalid code before touching the memo
	shelterDbs.delete(shelterCode.toUpperCase());
	return ensureShelterPrintingDb(shelterCode);
}

/** Test-only: forget which databases this process has provisioned. */
export function resetPrintingProvisionForTests(): void {
	devicesDb = null;
	shelterDbs.clear();
}

export interface CloseShelterPrintingDeps {
	/** Device registry (`printing_devices`); defaults to {@link printDeviceRepository}. */
	devices: PrintDeviceAdminStore & PrintDeviceLister;
	/** Job store of one shelter; defaults to {@link printJobStoreFor}. */
	jobsFor: (shelterCode: string) => PrinterJobCloser;
	now?: () => Date;
}

/** Deactivating never links a scanner, so the kiosk lookup is never reached. */
const NO_SCANNERS: KioskDeviceReader = { getDeviceByDeviceId: async () => null };

/**
 * Real adapters, imported on demand: `print-device.repo` itself imports this module for
 * `ensurePrintingDevicesDb`, so a top-level import would be a cycle.
 */
async function defaultCloseDeps(): Promise<CloseShelterPrintingDeps> {
	const [{ printDeviceRepository }, { printJobStoreFor }] = await Promise.all([
		import('./print-device.repo'),
		import('./print-job.service-store')
	]);
	return { devices: printDeviceRepository, jobsFor: printJobStoreFor };
}

/**
 * Close a shelter's printing (O-11): its printers go `inactive` through `updatePrinter` (open jobs
 * become `failed (printer_inactive)`), then `printing_{code}` and its registry doc are deleted.
 * Immediate and idempotent; the same for `closed` and `cancelled` shelters. Throws for a code that
 * cannot form a database name, before any request.
 */
export async function closeShelterPrinting(
	shelterCode: string,
	deps?: CloseShelterPrintingDeps
): Promise<ShelterCloseReport> {
	const { devices, jobsFor, now = () => new Date() } = deps ?? (await defaultCloseDeps());
	const report = await closeShelterPrintingWith(
		{
			admin: (path, method, body) => adminRaw(path, method, body),
			printerIds: async (code) => (await devices.listDevices(code)).map((device) => device._id),
			async deactivate(printerId) {
				await updatePrinter(
					{ devices, jobsFor, scanners: NO_SCANNERS },
					printerId,
					{ status: 'inactive' },
					now()
				);
			}
		},
		shelterCode
	);
	// The next printer of this shelter must provision `printing_{code}` afresh, not hit the memo.
	shelterDbs.delete(report.code);
	return report;
}
