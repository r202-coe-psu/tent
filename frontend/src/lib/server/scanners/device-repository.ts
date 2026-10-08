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
	type ScannerDeviceSummary,
	type StaffPinReveal
} from '$lib/features/scanners/domain/scanner.schema';
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
 * written SECOND. If the metadata write fails, the secret write is rolled back (best effort) so the
 * SA's error means "nothing changed". Delete runs the other way round (registry first) so a device
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
			// Only our own revision is removed, so a concurrent create's PIN is never deleted.
			await this.bestEffort('rollback create', input.device_id, () =>
				this.secrets.remove(input.device_id, secret._rev)
			);
			if (error instanceof ScannerConflictError) throw error;
			return rethrowDependency(error);
		}
		return { device: parsePersistedDevice(document), plaintext_secret, plaintext_staff_pin };
	}

	/**
	 * Delete a device and its staff PIN (SA only, enforced by the route). Registry first: once the
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

	/** Run a compensating step; log (never the PIN) instead of masking the original outcome. */
	private async bestEffort(
		action: string,
		deviceId: string,
		step: () => Promise<void>
	): Promise<void> {
		try {
			await step();
		} catch (error) {
			console.error(
				`[scanner-staff-pin] ${action} failed device=${deviceId}: ${error instanceof Error ? error.name : 'unknown'}`
			);
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
			await this.bestEffort('rollback PIN change', device.device_id, () =>
				this.restoreSecret(device.device_id, previous, saved._rev)
			);
			throw error;
		}
	}

	/** Put the PIN doc back to what it was before a failed {@link setStaffPin}. */
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
