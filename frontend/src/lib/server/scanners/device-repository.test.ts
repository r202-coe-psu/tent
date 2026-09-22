import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminFetch, adminRaw } from '$lib/server/couch-admin';
import { ScannerConflictError } from './device-credentials';
import { ScannerDeviceRepository } from './device-repository';

vi.mock('$lib/server/couch-admin', () => ({
	adminFetch: vi.fn(),
	adminRaw: vi.fn()
}));

describe('ScannerDeviceRepository', () => {
	const mockFetch = vi.mocked(adminFetch);
	const mockRaw = vi.mocked(adminRaw);
	let repository: ScannerDeviceRepository;

	beforeEach(() => {
		vi.clearAllMocks();
		repository = new ScannerDeviceRepository();
		mockFetch.mockResolvedValue({ docs: [{ type: 'shelter', code: 'SH001' }] });
		mockRaw.mockResolvedValue({ status: 201, data: { ok: true } });
	});

	it('generates and persists only a hash/prefix under deterministic id', async () => {
		const result = await repository.createDevice(
			{
				device_id: 'kiosk-sh001-01',
				name: 'จุดคัดกรอง 1',
				shelter_code: 'SH001',
				station_name: 'โต๊ะ 1',
				status: 'active'
			},
			'sa-user'
		);

		const putBody = mockRaw.mock.calls[0]?.[2] as Record<string, unknown>;
		expect(mockRaw.mock.calls[0]?.[0]).toBe('/registry/scanner_device%3Akiosk-sh001-01');
		expect(putBody._id).toBe('scanner_device:kiosk-sh001-01');
		expect(putBody.secret_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(putBody.secret_prefix).toBe(`${result.plaintext_secret.slice(0, 16)}...`);
		expect(putBody).not.toHaveProperty('plaintext_secret');
		expect(result.device.secret_hash).toBe(putBody.secret_hash);
		expect(result.plaintext_secret.startsWith('sk_scan_')).toBe(true);
	});

	it('maps CouchDB deterministic duplicate to a conflict', async () => {
		mockRaw.mockResolvedValue({ status: 409, data: { error: 'conflict' } });

		await expect(
			repository.createDevice(
				{
					device_id: 'kiosk-sh001-01',
					name: 'จุดคัดกรอง 1',
					shelter_code: 'SH001',
					station_name: 'โต๊ะ 1',
					status: 'active'
				},
				'sa-user'
			)
		).rejects.toBeInstanceOf(ScannerConflictError);
	});
});
