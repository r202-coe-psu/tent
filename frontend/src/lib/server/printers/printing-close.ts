// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel pulls client UI/query code
import { PRINTING_DEVICES_DB, printingDbName } from '$lib/features/printers/domain/printing-db';
import { PrintDependencyError, type PrintDeviceDoc } from './device-credentials';
import { terminal, type PrintJobDoc } from './print-queue.server';

/**
 * Closing a shelter's printing (plan §4.4, O-11): printers off, then the shelter DB and its
 * registry doc gone. The ordering and idempotency live here, free of `$env` / `couch-admin`, so
 * the server (`printing-provision.closeShelterPrinting`) and the plain-`tsx` ops script
 * (`scripts/close-shelter-printing.ts`) share them and differ only in the ports they plug in.
 */

/** Raw request as the CouchDB server admin (`adminRaw` contract: never throws on HTTP errors). */
export type AdminRaw = (
	path: string,
	method: string,
	body?: unknown
) => Promise<{ status: number; data: unknown }>;

export interface CloseShelterPorts {
	admin: AdminRaw;
	/** `_id`s (`print_device:{id}`) of every printer registered to the shelter, any status. */
	printerIds(shelterCode: string): Promise<string[]>;
	/** Set the printer inactive and fail its open jobs `printer_inactive` (FR-15). */
	deactivate(printerId: string): Promise<void>;
}

export interface ShelterCloseTarget {
	code: string;
	/** `printing_{code}` */
	db: string;
	/** `printing_db:{CODE}` in `printing_devices` */
	registryId: string;
}

export interface ShelterCloseReport extends ShelterCloseTarget {
	printerIds: string[];
	dryRun: boolean;
}

/** Names the close touches. Throws for a code that cannot form a database name, before any request. */
export function shelterCloseTarget(shelterCode: string): ShelterCloseTarget {
	const db = printingDbName(shelterCode);
	const code = shelterCode.toUpperCase();
	return { code, db, registryId: `printing_db:${code}` };
}

/** DELETE answers 200/202 when it removed something and 404 when it was already gone. */
function expectGone(status: number): void {
	if (status !== 200 && status !== 202 && status !== 404) throw new PrintDependencyError();
}

async function deleteRegistryDoc(admin: AdminRaw, registryId: string): Promise<void> {
	const path = `/${PRINTING_DEVICES_DB}/${encodeURIComponent(registryId)}`;
	const existing = await admin(path, 'GET');
	if (existing.status === 404) return;
	if (existing.status !== 200) throw new PrintDependencyError();
	const rev = (existing.data as { _rev: string })._rev;
	expectGone((await admin(`${path}?rev=${encodeURIComponent(rev)}`, 'DELETE')).status);
}

/**
 * Close a shelter's printing now, without waiting for the db to drain. Order matters: (1) every
 * printer inactive with its open jobs failed, (2) delete `printing_{code}`, (3) delete the registry
 * doc, so a crash leaves the registry pointing at the db and a rerun picks up where it stopped.
 * Idempotent: a missing db / registry doc is fine. `dryRun` only reads and reports the plan.
 */
export async function closeShelterPrintingWith(
	ports: CloseShelterPorts,
	shelterCode: string,
	{ dryRun = false }: { dryRun?: boolean } = {}
): Promise<ShelterCloseReport> {
	const target = shelterCloseTarget(shelterCode);
	const printerIds = await ports.printerIds(target.code);
	if (dryRun) return { ...target, printerIds, dryRun };

	for (const printerId of printerIds) await ports.deactivate(printerId);
	expectGone((await ports.admin(`/${target.db}`, 'DELETE')).status);
	await deleteRegistryDoc(ports.admin, target.registryId);
	return { ...target, printerIds, dryRun };
}

/** Mango only picks the `[printer_id, status, created_at]` json index when the selector names every field. */
const ANY = { $gt: null };
const MAX_WRITE_ATTEMPTS = 4;
/** Upper bound on `_find` pages per status, so a stuck conflict cannot spin forever. */
const MAX_CLOSE_PAGES = 50;

/**
 * Admin-backed `printerIds` / `deactivate` for the ops script, which runs under plain `tsx` and so
 * cannot reach `updatePrinter` (it pulls `$env`). Same effect: the device doc goes `inactive`
 * first (no new job can be queued or claimed), then its pending/printing jobs fail
 * `printer_inactive` with the labels dropped. A `_rev` conflict means a heartbeat or a claim got in
 * between: re-read and retry.
 */
export function adminClosePorts(
	admin: AdminRaw,
	now: () => Date
): Pick<CloseShelterPorts, 'printerIds' | 'deactivate'> {
	const devicePath = (printerId: string) =>
		`/${PRINTING_DEVICES_DB}/${encodeURIComponent(printerId)}`;

	async function setInactive(printerId: string): Promise<PrintDeviceDoc | null> {
		for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
			const read = await admin(devicePath(printerId), 'GET');
			if (read.status === 404) return null;
			if (read.status !== 200) throw new PrintDependencyError();
			const doc = read.data as PrintDeviceDoc;
			const write = await admin(devicePath(printerId), 'PUT', {
				...doc,
				status: 'inactive',
				updated_at: now().toISOString()
			});
			if (write.status === 201 || write.status === 202) return doc;
			if (write.status !== 409) throw new PrintDependencyError();
		}
		throw new PrintDependencyError();
	}

	async function failOpenJobs(db: string, printerId: string): Promise<void> {
		for (const status of ['pending', 'printing'] as const) {
			for (let page = 0; page < MAX_CLOSE_PAGES; page += 1) {
				const found = await admin(`/${db}/_find`, 'POST', {
					selector: { type: 'print_job', printer_id: printerId, status, created_at: ANY },
					limit: 100
				});
				if (found.status === 404) return;
				if (found.status !== 200) throw new PrintDependencyError();
				let written = 0;
				for (const job of (found.data as { docs: PrintJobDoc[] }).docs) {
					const put = await admin(
						`/${db}/${encodeURIComponent(job._id)}`,
						'PUT',
						terminal(job, 'failed', now(), { error_code: 'printer_inactive' })
					);
					if (put.status === 201 || put.status === 202) written += 1;
					else if (put.status !== 409) throw new PrintDependencyError();
				}
				if (written === 0) break;
			}
		}
	}

	return {
		async printerIds(shelterCode) {
			const { status, data } = await admin(`/${PRINTING_DEVICES_DB}/_find`, 'POST', {
				selector: { type: 'print_device', shelter_code: shelterCode },
				limit: 1000
			});
			if (status !== 200) throw new PrintDependencyError();
			return (data as { docs: PrintDeviceDoc[] }).docs.map((device) => device._id);
		},

		async deactivate(printerId) {
			const device = await setInactive(printerId);
			if (device) await failOpenJobs(printingDbName(device.shelter_code), printerId);
		}
	};
}
