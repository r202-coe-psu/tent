import { beforeEach, describe, expect, it } from 'vitest';
import { ScannerRemoteRepository } from './scanner.remote';
import type { PersistedScannerDeviceV1, PersistedScannerDeviceV2 } from '../domain/scanner.schema';
import type { Repository } from '$lib/db/repository';

class MockRepository implements Repository {
	private store = new Map<string, unknown>();

	seed(doc: PersistedScannerDeviceV1 | PersistedScannerDeviceV2) {
		this.store.set(doc._id, structuredClone(doc));
	}

	async put<T extends { _id: string }>(doc: T): Promise<T> {
		this.store.set(doc._id, structuredClone(doc));
		return doc;
	}

	async get<T extends { _id: string }>(id: string): Promise<T | null> {
		const doc = this.store.get(id);
		return doc ? structuredClone(doc as T) : null;
	}

	async remove(doc: { _id: string }): Promise<void> {
		this.store.delete(doc._id);
	}

	async allByType<T extends { _id: string; type: string }>(
		_type: string,
		guard: (d: unknown) => d is T
	): Promise<T[]> {
		return Array.from(this.store.values()).filter(guard);
	}

	async pageByType<T extends { _id: string; type: string }>(
		type: string,
		guard: (d: unknown) => d is T,
		page: number,
		pageSize: number
	) {
		const all = await this.allByType(type, guard);
		return {
			items: all.slice((page - 1) * pageSize, page * pageSize),
			total: all.length,
			page,
			pageSize,
			totalPages: Math.ceil(all.length / pageSize)
		};
	}

	async find<T>(): Promise<T[]> {
		return [];
	}

	async bulkDocs<T extends { _id: string; _rev?: string }>(docs: T[]): Promise<T[]> {
		for (const doc of docs) {
			this.store.set(doc._id, JSON.parse(JSON.stringify(doc)));
		}
		return docs;
	}
}

function persistedDevice(
	overrides: Partial<PersistedScannerDeviceV1> = {}
): PersistedScannerDeviceV1 {
	return {
		_id: 'scanner_device:SCAN-01',
		_rev: '1-a',
		type: 'scanner_device',
		schema_v: 1,
		created_at: '2026-08-30T00:00:00Z',
		updated_at: '2026-08-30T00:00:00Z',
		created_by: 'admin',
		device_id: 'SCAN-01',
		name: 'จุดคัดกรอง 1',
		shelter_code: 'SH001',
		station_name: 'โต๊ะ 1',
		secret_hash: 'a'.repeat(64),
		secret_prefix: 'sk_scan_aaaaaaaa...',
		status: 'active',
		last_seen_at: null,
		...overrides
	};
}

function persistedDeviceV2(
	overrides: Partial<PersistedScannerDeviceV2> = {}
): PersistedScannerDeviceV2 {
	return {
		...persistedDevice(),
		schema_v: 2,
		staff_pin_set: true,
		staff_pin_is_default: true,
		staff_pin_updated_at: '2026-08-30T00:00:00Z',
		staff_pin_updated_by: 'admin',
		...overrides
	};
}

describe('ScannerRemoteRepository', () => {
	let registry: MockRepository;
	let scannerRepo: ScannerRemoteRepository;

	beforeEach(() => {
		registry = new MockRepository();
		scannerRepo = new ScannerRemoteRepository('registry', registry);
	});

	it('redacts secret hash, prefix, revision, and persistence envelope for browser summaries', async () => {
		registry.seed(persistedDevice());

		const [device] = await scannerRepo.listDevices();
		expect(device).toEqual({
			id: 'scanner_device:SCAN-01',
			device_id: 'SCAN-01',
			name: 'จุดคัดกรอง 1',
			shelter_code: 'SH001',
			station_name: 'โต๊ะ 1',
			status: 'active',
			last_seen_at: null,
			staff_pin_set: false,
			staff_pin_is_default: false
		});
		expect(device).not.toHaveProperty('secret_hash');
		expect(device).not.toHaveProperty('_rev');
	});

	it('lists v2 devices with PIN flags but no PIN metadata beyond them', async () => {
		registry.seed(persistedDeviceV2());

		const [device] = await scannerRepo.listDevices();
		expect(device.staff_pin_set).toBe(true);
		expect(device.staff_pin_is_default).toBe(true);
		expect(device).not.toHaveProperty('staff_pin_updated_by');
	});

	it('keeps the staff PIN metadata when a v2 device is edited from the browser', async () => {
		const seeded = persistedDeviceV2();
		registry.seed(seeded);

		await scannerRepo.updateDevice('scanner_device:SCAN-01', { status: 'inactive' });
		const stored = await registry.get<PersistedScannerDeviceV2>('scanner_device:SCAN-01');
		expect(stored?.staff_pin_set).toBe(true);
		expect(stored?.staff_pin_updated_at).toBe(seeded.staff_pin_updated_at);
		expect(stored?.schema_v).toBe(2);
	});

	it('updates a persisted device while returning a redacted summary', async () => {
		registry.seed(persistedDevice());

		const updated = await scannerRepo.updateDevice('scanner_device:SCAN-01', {
			name: 'Updated Name',
			status: 'inactive'
		});

		expect(updated.name).toBe('Updated Name');
		expect(updated.status).toBe('inactive');
		expect(updated).not.toHaveProperty('secret_hash');
	});
});
