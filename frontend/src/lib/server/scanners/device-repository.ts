import { adminFetch, adminRaw } from '$lib/server/couch-admin';
import { now, type Timestamp } from '$lib/db/model';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import {
	SCANNER_REGISTRY_DB,
	SCANNER_SCHEMA_V,
	scannerDevicePersistedSchema,
	toScannerDeviceSummary,
	type PersistedScannerDevice,
	type PersistedScannerDeviceV2,
	type ScannerDeviceInput,
	type ScannerDevicePatch,
	type ScannerDeviceSummary,
	type StaffPinReveal
} from '$lib/features/kiosk-devices/domain/scanner.schema';
import {
	generateScannerSecret,
	hashScannerSecret,
	ScannerConflictError,
	ScannerDependencyError,
	ScannerDeviceNotFoundError,
	ScannerMalformedDeviceError,
	ScannerShelterNotFoundError
} from './device-credentials';
import { generateStaffPin } from './staff-pin';
import {
	StaffPinNotSetError,
	staffPinSecretStore,
	StaffPinUnavailableError,
	type StaffPinSecret,
	type StaffPinSecretStore
} from './staff-pin-store';

export interface CreatedScannerDeviceRecord {
	device: PersistedScannerDevice;
	plaintext_secret: string;
	/** Generated default PIN, returned once to the SA who created the device. */
	plaintext_staff_pin: string;
}

/** Registry metadata writes retry a `_rev` race this many times (heartbeats bump `_rev` often). */
const METADATA_WRITE_ATTEMPTS = 3;

/** Upper bound on devices returned by one list (registry holds a handful per shelter). */
const LIST_LIMIT = 1000;

function parsePersistedDevice(value: unknown): PersistedScannerDevice {
	const parsed = scannerDevicePersistedSchema.safeParse(value);
	if (!parsed.success) throw new ScannerMalformedDeviceError();
	return parsed.data;
}

function rethrowDependency(error: unknown): never {
	if (error instanceof ScannerMalformedDeviceError) throw error;
	if (error instanceof ScannerDependencyError) throw error;
	throw new ScannerDependencyError();
}

/**
 * Server-side scanner registry access.
 *
 * Staff PIN write ordering: the secret doc in `scanner_secrets` is the source of truth for
 * verify/reveal and is written FIRST; the registry doc's `staff_pin_*` fields are display metadata
 * written SECOND. If the metadata write fails, the secret write is rolled back so the SA's error
 * means "nothing changed"; if the rollback fails too it is logged and surfaces as 503. Delete runs the other way round (registry first) so a device
 * never outlives its PIN with stale "PIN set" badges.
 */
export class ScannerDeviceRepository {
	constructor(private readonly secrets: StaffPinSecretStore = staffPinSecretStore) {}

	async getDeviceByDeviceId(deviceId: string): Promise<PersistedScannerDevice | null> {
		try {
			const result = await adminFetch<{ docs: unknown[] }>(`/${SCANNER_REGISTRY_DB}/_find`, {
				method: 'POST',
				body: JSON.stringify({
					selector: { type: 'scanner_device', device_id: deviceId },
					limit: 2
				})
			});
			const candidate = result.docs.find(
				(doc): doc is Record<string, unknown> =>
					!!doc &&
					typeof doc === 'object' &&
					(doc as Record<string, unknown>).device_id === deviceId
			);
			return candidate ? parsePersistedDevice(candidate) : null;
		} catch (error) {
			return rethrowDependency(error);
		}
	}

	private async getDeviceById(id: string): Promise<PersistedScannerDevice> {
		try {
			const result = await adminFetch<unknown>(`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}`);
			return parsePersistedDevice(result);
		} catch (error) {
			return rethrowDependency(error);
		}
	}

	/**
	 * Scanner devices of the given shelters (`null` = every shelter, SA). `registry` has no Mango
	 * index on `shelter_code`, so the selector is `type` only and the shelter filter runs in memory
	 * (a deployment has few devices). A doc that fails to parse is skipped and logged, not fatal.
	 */
	async listDevices(shelterCodes: string[] | null): Promise<PersistedScannerDevice[]> {
		let docs: unknown[];
		try {
			const result = await adminFetch<{ docs: unknown[] }>(`/${SCANNER_REGISTRY_DB}/_find`, {
				method: 'POST',
				body: JSON.stringify({ selector: { type: 'scanner_device' }, limit: LIST_LIMIT })
			});
			docs = result.docs;
		} catch (error) {
			return rethrowDependency(error);
		}

		const devices: PersistedScannerDevice[] = [];
		for (const doc of docs) {
			const parsed = scannerDevicePersistedSchema.safeParse(doc);
			if (!parsed.success) {
				const id = (doc as { _id?: unknown } | null)?._id;
				console.warn(`[scanner-device] skipped malformed registry doc ${String(id)}`);
				continue;
			}
			if (shelterCodes === null || shelterCodes.includes(parsed.data.shelter_code)) {
				devices.push(parsed.data);
			}
		}
		return devices;
	}

	/**
	 * The registry doc for `id` (`scanner_device:{device_id}`), or NotFound. Routes call this to
	 * check the caller's shelter scope before acting on the device.
	 */
	async getDevice(id: string): Promise<PersistedScannerDevice> {
		return this.findDeviceById(id);
	}

	/** Like {@link getDeviceById} but maps a missing (or non-scanner) doc to NotFound. */
	private async findDeviceById(id: string): Promise<PersistedScannerDevice> {
		let result: { status: number; data: unknown };
		try {
			result = await adminRaw(`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}`, 'GET');
		} catch (error) {
			return rethrowDependency(error);
		}
		if (result.status === 404) throw new ScannerDeviceNotFoundError();
		if (result.status < 200 || result.status >= 300) throw new ScannerDependencyError();
		const data = result.data as { type?: unknown } | null;
		if (data?.type !== 'scanner_device') throw new ScannerDeviceNotFoundError();
		return parsePersistedDevice(data);
	}

	private async hasShelter(shelterCode: string): Promise<boolean> {
		try {
			const result = await adminFetch<{ docs: Array<{ type?: unknown; code?: unknown }> }>(
				`/${SCANNER_REGISTRY_DB}/_find`,
				{
					method: 'POST',
					body: JSON.stringify({
						selector: { type: 'shelter', code: shelterCode },
						limit: 1
					})
				}
			);
			return result.docs.some((doc) => doc.type === 'shelter' && doc.code === shelterCode);
		} catch (error) {
			return rethrowDependency(error);
		}
	}

	async createDevice(
		input: ScannerDeviceInput,
		createdBy: string
	): Promise<CreatedScannerDeviceRecord> {
		if (!(await this.hasShelter(input.shelter_code))) throw new ScannerShelterNotFoundError();

		const deviceId = `scanner_device:${input.device_id}`;
		// Check before touching the secrets store: writing a PIN for an id that already exists would
		// replace that live device's PIN.
		if (await this.registryDocExists(deviceId)) throw new ScannerConflictError();

		const plaintext_secret = generateScannerSecret();
		const plaintext_staff_pin = generateStaffPin();
		const timestamp = now();

		// Secret first. A leftover PIN doc (device deleted outside this server) is replaced.
		const orphan = await this.secrets.get(input.device_id);
		const secret = await this.secrets.put(
			{
				device_id: input.device_id,
				pin: plaintext_staff_pin,
				is_default: true,
				updated_at: timestamp,
				updated_by: createdBy
			},
			orphan?._rev ?? null
		);

		const document: PersistedScannerDeviceV2 = {
			_id: deviceId,
			type: 'scanner_device',
			schema_v: SCANNER_SCHEMA_V,
			device_id: input.device_id,
			name: input.name,
			shelter_code: input.shelter_code,
			station_name: input.station_name,
			screen_type: input.screen_type,
			secret_hash: hashScannerSecret(plaintext_secret),
			secret_prefix: `${plaintext_secret.slice(0, 16)}...`,
			status: input.status,
			last_seen_at: null as Timestamp | null,
			created_at: timestamp,
			updated_at: timestamp,
			created_by: createdBy,
			staff_pin_set: true,
			staff_pin_is_default: true,
			staff_pin_updated_at: timestamp,
			staff_pin_updated_by: createdBy
		};

		try {
			const result = await adminRaw(
				`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(deviceId)}`,
				'PUT',
				document
			);
			if (result.status === 409) throw new ScannerConflictError();
			if (result.status < 200 || result.status >= 300) throw new ScannerDependencyError();
		} catch (error) {
			// Put back what was there (rev-guarded on our own revision): if a concurrent create of the
			// same device_id won the registry race after we replaced its PIN, deleting ours would leave
			// that live device with no PIN at all.
			const rolledBack = await this.bestEffort('rollback create', input.device_id, () =>
				this.restoreSecret(input.device_id, orphan, secret._rev)
			);
			// The PIN doc may now disagree with the registry; `sync:central` reconciles it.
			if (!rolledBack) throw new StaffPinUnavailableError('Rollback of staff PIN failed');
			if (error instanceof ScannerConflictError) throw error;
			return rethrowDependency(error);
		}
		return { device: parsePersistedDevice(document), plaintext_secret, plaintext_staff_pin };
	}

	/**
	 * Change a device's name, station and/or status. Only those fields are written; PIN metadata,
	 * secret, shelter, ids and `created_*` come from the stored doc untouched. A `_rev` race (the
	 * kiosk bumps `last_seen_at` on every call) is retried on a fresh read so the newer heartbeat
	 * survives; after {@link METADATA_WRITE_ATTEMPTS} races it fails with {@link ScannerConflictError}.
	 */
	async updateDevice(
		id: string,
		patch: ScannerDevicePatch & { banner_group_id?: string | null },
		updatedBy: string
	): Promise<PersistedScannerDevice> {
		const fields = Object.fromEntries(
			Object.entries(patch).filter(([, value]) => value !== undefined)
		) as ScannerDevicePatch;

		let current = await this.findDeviceById(id);
		for (let attempt = 1; ; attempt += 1) {
			const updated = parsePersistedDevice({ ...current, ...fields, updated_at: now() });
			let result: { status: number; data: unknown };
			try {
				result = await adminRaw(
					`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}`,
					'PUT',
					updated
				);
			} catch (error) {
				return rethrowDependency(error);
			}
			if (result.status >= 200 && result.status < 300) {
				console.info(
					`[scanner-device] updated device=${updated.device_id} shelter=${updated.shelter_code} fields=${Object.keys(fields).join(',')} by=${updatedBy} at=${updated.updated_at}`
				);
				const rev = (result.data as { rev?: unknown } | null)?.rev;
				return typeof rev === 'string' ? { ...updated, _rev: rev } : updated;
			}
			if (result.status !== 409) throw new ScannerDependencyError();
			if (attempt >= METADATA_WRITE_ATTEMPTS) {
				throw new ScannerConflictError('Scanner device was modified concurrently');
			}
			current = await this.findDeviceById(id);
		}
	}

	/**
	 * Put the given devices (registry doc ids) into a banner group, `null` = no group. Each device
	 * is written through {@link updateDevice}, so a `_rev` race is retried on a fresh read.
	 */
	async setBannerGroup(
		deviceIds: string[],
		groupId: string | null,
		updatedBy: string
	): Promise<PersistedScannerDevice[]> {
		const updated: PersistedScannerDevice[] = [];
		for (const id of deviceIds) {
			updated.push(await this.updateDevice(id, { banner_group_id: groupId }, updatedBy));
		}
		return updated;
	}

	/**
	 * Delete a device and its staff PIN (caller scope is enforced by the route). Registry first: once the
	 * device is gone it cannot authenticate, so a PIN doc left by a failed second step is inert and
	 * is replaced if the id is ever registered again.
	 */
	async deleteDevice(id: string): Promise<void> {
		const current = await this.findDeviceById(id);
		let result: { status: number; data: unknown };
		try {
			result = await adminRaw(
				`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}?rev=${encodeURIComponent(current._rev ?? '')}`,
				'DELETE'
			);
		} catch (error) {
			return rethrowDependency(error);
		}
		if (result.status === 404) throw new ScannerDeviceNotFoundError();
		if (result.status === 409) {
			throw new ScannerConflictError('Scanner device was modified concurrently');
		}
		if (result.status < 200 || result.status >= 300) throw new ScannerDependencyError();

		await this.bestEffort('remove PIN of deleted device', current.device_id, () =>
			this.secrets.remove(current.device_id)
		);
	}

	private async registryDocExists(id: string): Promise<boolean> {
		let result: { status: number; data: unknown };
		try {
			result = await adminRaw(`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}`, 'GET');
		} catch (error) {
			return rethrowDependency(error);
		}
		if (result.status === 404) return false;
		if (result.status === 200) return true;
		throw new ScannerDependencyError();
	}

	/**
	 * Run a compensating step; log (never the PIN) instead of masking the original outcome.
	 * `false` = the step failed and was logged.
	 */
	private async bestEffort(
		action: string,
		deviceId: string,
		step: () => Promise<void>
	): Promise<boolean> {
		try {
			await step();
			return true;
		} catch (error) {
			console.error(
				`[scanner-staff-pin] ${action} failed device=${deviceId}: ${error instanceof Error ? error.name : 'unknown'}`
			);
			return false;
		}
	}

	async updateDeviceLastSeen(id: string): Promise<void> {
		const current = await this.getDeviceById(id);
		const updated: PersistedScannerDevice = {
			...current,
			last_seen_at: now(),
			updated_at: now()
		};
		try {
			await adminFetch(`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}`, {
				method: 'PUT',
				body: JSON.stringify(updated)
			});
		} catch (error) {
			return rethrowDependency(error);
		}
	}

	/**
	 * Store a staff PIN for a device (v1 docs are upgraded to v2). Secret first, then registry
	 * metadata; a stale secret `_rev` surfaces as {@link ScannerConflictError}.
	 */
	async setStaffPin(
		id: string,
		pin: string,
		updatedBy: string,
		options: { isDefault?: boolean } = {}
	): Promise<void> {
		const device = await this.findDeviceById(id);
		const previous = await this.secrets.get(device.device_id);
		const timestamp = now();
		const isDefault = options.isDefault ?? false;

		const saved = await this.secrets.put(
			{
				device_id: device.device_id,
				pin,
				is_default: isDefault,
				updated_at: timestamp,
				updated_by: updatedBy
			},
			previous?._rev ?? null
		);

		try {
			await this.writeStaffPinMetadata(id, device, {
				staff_pin_set: true,
				staff_pin_is_default: isDefault,
				staff_pin_updated_at: timestamp,
				staff_pin_updated_by: updatedBy
			});
		} catch (error) {
			const rolledBack = await this.bestEffort('rollback PIN change', device.device_id, () =>
				this.restoreSecret(device.device_id, previous, saved._rev)
			);
			// The PIN doc may now disagree with the registry; `sync:central` reconciles it.
			if (!rolledBack) throw new StaffPinUnavailableError('Rollback of staff PIN failed');
			throw error;
		}
	}

	/** Put the PIN doc back to what it was before a failed {@link setStaffPin} / create. */
	private async restoreSecret(
		deviceId: string,
		previous: StaffPinSecret | null,
		savedRev: string
	): Promise<void> {
		if (!previous) {
			await this.secrets.remove(deviceId, savedRev);
			return;
		}
		await this.secrets.put(
			{
				device_id: deviceId,
				pin: previous.pin,
				is_default: previous.is_default,
				updated_at: previous.updated_at,
				updated_by: previous.updated_by
			},
			savedRev
		);
	}

	/**
	 * Write the server-owned `staff_pin_*` fields onto the registry doc. These fields are written
	 * only here, so a `_rev` conflict (usually a heartbeat or a browser edit of name/status) is
	 * retried on a fresh read rather than overwriting the other change.
	 */
	private async writeStaffPinMetadata(
		id: string,
		initial: PersistedScannerDevice,
		metadata: Pick<
			PersistedScannerDeviceV2,
			'staff_pin_set' | 'staff_pin_is_default' | 'staff_pin_updated_at' | 'staff_pin_updated_by'
		>
	): Promise<void> {
		let current = initial;
		for (let attempt = 1; ; attempt += 1) {
			const updated: PersistedScannerDeviceV2 = {
				...current,
				...metadata,
				schema_v: SCANNER_SCHEMA_V,
				updated_at: metadata.staff_pin_updated_at ?? now()
			};
			let result: { status: number; data: unknown };
			try {
				result = await adminRaw(
					`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}`,
					'PUT',
					parsePersistedDevice(updated)
				);
			} catch (error) {
				return rethrowDependency(error);
			}
			if (result.status >= 200 && result.status < 300) return;
			if (result.status !== 409) throw new ScannerDependencyError();
			if (attempt >= METADATA_WRITE_ATTEMPTS) {
				throw new ScannerConflictError('Scanner device was modified concurrently');
			}
			current = await this.findDeviceById(id);
		}
	}

	/** Replace the PIN with a fresh random one and return it (shown once to the SA who asked). */
	async regenerateStaffPin(id: string, updatedBy: string): Promise<string> {
		const pin = generateStaffPin();
		await this.setStaffPin(id, pin, updatedBy);
		return pin;
	}

	/** The device's PIN for SA. Throws {@link StaffPinNotSetError} when none is stored. */
	async revealStaffPin(id: string): Promise<StaffPinReveal> {
		const device = await this.findDeviceById(id);
		const secret = await this.secrets.get(device.device_id);
		if (!secret) throw new StaffPinNotSetError();
		return {
			pin: secret.pin,
			is_default: secret.is_default,
			updated_at: secret.updated_at,
			updated_by: secret.updated_by
		};
	}

	toSummary(device: PersistedScannerDevice): ScannerDeviceSummary {
		return toScannerDeviceSummary(device);
	}
}

export const scannerDeviceRepository = new ScannerDeviceRepository();
