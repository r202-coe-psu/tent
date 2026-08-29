import { beforeEach, describe, expect, it } from 'vitest';
import { generateRandomSecret, hashSecret, ScannerRemoteRepository } from './scanner.remote';
import type { Repository } from '$lib/db/repository';

class MockRepository implements Repository {
	private store = new Map<string, unknown>();

	async put<T extends { _id: string }>(doc: T): Promise<T> {
		this.store.set(doc._id, JSON.parse(JSON.stringify(doc)));
		return doc;
	}

	async get<T extends { _id: string }>(id: string): Promise<T | null> {
		const doc = this.store.get(id);
		return doc ? JSON.parse(JSON.stringify(doc)) : null;
	}

	async remove(doc: { _id: string }): Promise<void> {
		this.store.delete(doc._id);
	}

	async allByType<T extends { _id: string; type: string }>(
		type: string,
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
}

describe('ScannerRemoteRepository', () => {
	let mockCatalogRepo: MockRepository;
	let scannerRepo: ScannerRemoteRepository;

	beforeEach(() => {
		mockCatalogRepo = new MockRepository();
		scannerRepo = new ScannerRemoteRepository('catalog', mockCatalogRepo);
	});

	describe('Secret helpers', () => {
		it('generates a random secret with sk_scan_ prefix', () => {
			const secret = generateRandomSecret();
			expect(secret.startsWith('sk_scan_')).toBe(true);
			expect(secret.length).toBeGreaterThan(20);
		});

		it('hashes secret deterministically', async () => {
			const secret = 'sk_scan_test12345';
			const hash1 = await hashSecret(secret);
			const hash2 = await hashSecret(secret);
			expect(hash1).toBe(hash2);
			expect(hash1.length).toBe(64);
		});
	});

	describe('Device Management', () => {
		it('creates a new scanner device and returns plaintext secret', async () => {
			const created = await scannerRepo.createDevice(
				{
					device_id: 'SCAN-01',
					name: 'จุดคัดกรอง 1',
					shelter_code: 'SH001',
					station_name: 'เคาน์เตอร์ A',
					status: 'active'
				},
				'admin_user'
			);

			expect(created.type).toBe('scanner_device');
			expect(created.device_id).toBe('SCAN-01');
			expect(created.plaintext_secret).toBeDefined();
			expect(created.plaintext_secret.startsWith('sk_scan_')).toBe(true);
			expect(created.secret_hash).toBeDefined();

			const fetched = await scannerRepo.getDeviceByDeviceId('SCAN-01');
			expect(fetched).not.toBeNull();
			expect(fetched?.name).toBe('จุดคัดกรอง 1');
			expect(fetched?.secret).toBe(created.plaintext_secret);
		});

		it('throws error when creating duplicate device_id', async () => {
			await scannerRepo.createDevice({
				device_id: 'SCAN-DUP',
				name: 'First',
				shelter_code: 'SH001',
				station_name: 'A',
				status: 'active'
			});

			await expect(
				scannerRepo.createDevice({
					device_id: 'SCAN-DUP',
					name: 'Second',
					shelter_code: 'SH001',
					station_name: 'B',
					status: 'active'
				})
			).rejects.toThrow('มีอยู่ในระบบแล้ว');
		});

		it('updates device attributes', async () => {
			const created = await scannerRepo.createDevice({
				device_id: 'SCAN-UPDATE',
				name: 'Original Name',
				shelter_code: 'SH001',
				station_name: 'A',
				status: 'active'
			});

			const updated = await scannerRepo.updateDevice(created._id, {
				name: 'Updated Name',
				status: 'inactive'
			});

			expect(updated.name).toBe('Updated Name');
			expect(updated.status).toBe('inactive');
		});

		it('deletes device', async () => {
			const created = await scannerRepo.createDevice({
				device_id: 'SCAN-DEL',
				name: 'To Delete',
				shelter_code: 'SH001',
				station_name: 'A',
				status: 'active'
			});

			await scannerRepo.deleteDevice(created._id);
			const fetched = await scannerRepo.getDevice(created._id);
			expect(fetched).toBeNull();
		});
	});
});
