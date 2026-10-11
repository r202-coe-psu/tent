import type { PersistedScannerDevice } from './domain/scanner.schema';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';

export type { PersistedScannerDevice, SmartCardData } from './domain/scanner.schema';

/** Server-side adapter for the authenticated scanner device registry. */
export class ScannerServerRepository {
	getDeviceByDeviceId(deviceId: string): Promise<PersistedScannerDevice | null> {
		return scannerDeviceRepository.getDeviceByDeviceId(deviceId);
	}

	updateDeviceLastSeen(id: string): Promise<void> {
		return scannerDeviceRepository.updateDeviceLastSeen(id);
	}
}

export const scannerServerRepository = new ScannerServerRepository();
