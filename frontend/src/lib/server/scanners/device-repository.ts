import { adminFetch, adminRaw } from '$lib/server/couch-admin';
import { now, type Timestamp } from '$lib/db/model';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import {
	SCANNER_REGISTRY_DB,
	scannerDevicePersistedSchema,
	toScannerDeviceSummary,
	type PersistedScannerDevice,
	type ScannerDeviceInput,
	type ScannerDeviceSummary
} from '$lib/features/scanners/domain/scanner.schema';
import {
	generateScannerSecret,
	hashScannerSecret,
	ScannerConflictError,
	ScannerDependencyError,
	ScannerMalformedDeviceError,
	ScannerShelterNotFoundError
} from './device-credentials';

export interface CreatedScannerDeviceRecord {
	device: PersistedScannerDevice;
	plaintext_secret: string;
}

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

export class ScannerDeviceRepository {
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

		const plaintext_secret = generateScannerSecret();
		const timestamp = now();
		const deviceId = `scanner_device:${input.device_id}`;
		const document = {
			_id: deviceId,
			type: 'scanner_device' as const,
			schema_v: 1 as const,
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
			created_by: createdBy
		};

		try {
			const result = await adminRaw(
				`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(deviceId)}`,
				'PUT',
				document
			);
			if (result.status === 409) throw new ScannerConflictError();
			if (result.status < 200 || result.status >= 300) throw new ScannerDependencyError();
			return { device: parsePersistedDevice(document), plaintext_secret };
		} catch (error) {
			if (error instanceof ScannerConflictError) throw error;
			return rethrowDependency(error);
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

	toSummary(device: PersistedScannerDevice): ScannerDeviceSummary {
		return toScannerDeviceSummary(device);
	}
}

export const scannerDeviceRepository = new ScannerDeviceRepository();
