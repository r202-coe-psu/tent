import {
	isPersistedScannerDevice,
	SCANNER_REGISTRY_DB,
	toScannerDeviceSummary,
	type PersistedScannerDevice,
	type ScannerDevice
} from '../domain/scanner.schema';
import { now } from '$lib/db/model';
import { createRemoteRepository, type Repository } from '$lib/db/repository';

export class ScannerRemoteRepository {
	private readonly registryRepo: Repository;

	constructor(
		private readonly registryDb: string = SCANNER_REGISTRY_DB,
		registryRepository?: Repository
	) {
		this.registryRepo = registryRepository ?? createRemoteRepository(registryDb);
	}

	// ---------------------------------------------------------------- Device Management

	async listDevices(shelterCode?: string): Promise<ScannerDevice[]> {
		const devices = await this.registryRepo.allByType<PersistedScannerDevice>(
			'scanner_device',
			isPersistedScannerDevice
		);
		const summaries = devices.map(toScannerDeviceSummary);
		if (shelterCode) {
			return summaries.filter((d) => d.shelter_code === shelterCode);
		}
		return summaries;
	}

	async getDevice(id: string): Promise<ScannerDevice | null> {
		const device = await this.registryRepo.get<PersistedScannerDevice>(id);
		return device && isPersistedScannerDevice(device) ? toScannerDeviceSummary(device) : null;
	}

	async getDeviceByDeviceId(deviceId: string): Promise<ScannerDevice | null> {
		const devices = await this.listDevices();
		return devices.find((d) => d.device_id === deviceId) ?? null;
	}

	async updateDevice(
		id: string,
		patch: Partial<
			Pick<ScannerDevice, 'name' | 'shelter_code' | 'station_name' | 'status' | 'last_seen_at'>
		>
	): Promise<ScannerDevice> {
		const existing = await this.registryRepo.get<PersistedScannerDevice>(id);
		if (!existing || !isPersistedScannerDevice(existing)) {
			throw new Error(`Device "${id}" not found`);
		}

		const updated: PersistedScannerDevice = {
			...existing,
			...patch,
			updated_at: now()
		};

		return toScannerDeviceSummary(await this.registryRepo.put(updated));
	}

	async deleteDevice(id: string): Promise<void> {
		const existing = await this.registryRepo.get<PersistedScannerDevice>(id);
		if (existing && isPersistedScannerDevice(existing)) {
			await this.registryRepo.remove(existing);
		}
	}
}

export const scannerRepository = new ScannerRemoteRepository();
