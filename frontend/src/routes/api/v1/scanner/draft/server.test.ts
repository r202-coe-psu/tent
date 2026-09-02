import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { hashSecret, scannerServerRepository } from '$lib/features/scanners/server';
import type { Evacuee } from '$lib/features/people';

vi.mock('$lib/features/scanners/server', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/scanners/server')>(
		'$lib/features/scanners/server'
	);
	return {
		...actual,
		scannerServerRepository: {
			getDeviceByDeviceId: vi.fn(),
			updateDeviceLastSeen: vi.fn(),
			processCardScan: vi.fn()
		}
	};
});

describe('POST /api/v1/scanner/draft', () => {
	const mockGetDevice = vi.mocked(scannerServerRepository.getDeviceByDeviceId);
	const mockProcessScan = vi.mocked(scannerServerRepository.processCardScan);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	const validCardPayload = {
		citizen_id: '1234567890123',
		first_name_th: 'สมชาย',
		last_name_th: 'ใจดี',
		birth_date: '25350101',
		gender: 'male' as const,
		address_raw: '99/1 บางนา กรุงเทพมหานคร'
	};

	it('returns 401 if headers are missing', async () => {
		const request = new Request('http://localhost/api/v1/scanner/draft', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ card_data: validCardPayload })
		});

		const res = await POST({ request } as unknown as RequestEvent);
		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error).toContain('Missing X-Device-Id or X-Device-Secret');
	});

	it('returns 401 when device credentials are only in body (enforcing header-only auth)', async () => {
		const request = new Request('http://localhost/api/v1/scanner/draft', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				device_id: 'DEV-01',
				device_secret: 'sk_scan_secret123',
				card_data: validCardPayload
			})
		});

		const res = await POST({ request } as unknown as RequestEvent);
		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error).toContain('Missing X-Device-Id or X-Device-Secret');
	});

	it('returns 401 if device is not found or inactive', async () => {
		mockGetDevice.mockResolvedValue(null);

		const request = new Request('http://localhost/api/v1/scanner/draft', {
			method: 'POST',
			headers: {
				'x-device-id': 'DEV-01',
				'x-device-secret': 'sk_scan_secret123',
				'content-type': 'application/json'
			},
			body: JSON.stringify({ card_data: validCardPayload })
		});

		const res = await POST({ request } as unknown as RequestEvent);
		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error).toContain('Device not found or inactive');
	});

	it('returns 401 if secret hash does not match', async () => {
		const secret = 'sk_scan_correct_secret';
		const correctHash = await hashSecret(secret);

		mockGetDevice.mockResolvedValue({
			_id: 'device:01',
			type: 'scanner_device',
			schema_v: 1,
			created_at: '2026-08-30T00:00:00Z',
			updated_at: '2026-08-30T00:00:00Z',
			created_by: 'admin',
			device_id: 'DEV-01',
			name: 'จุดสแกน 1',
			shelter_code: 'SH001',
			station_name: 'โต๊ะ 1',
			secret_hash: correctHash,
			secret_prefix: 'sk_scan_corr...',
			status: 'active',
			last_seen_at: null
		});

		const request = new Request('http://localhost/api/v1/scanner/draft', {
			method: 'POST',
			headers: {
				'x-device-id': 'DEV-01',
				'x-device-secret': 'sk_scan_wrong_secret',
				'content-type': 'application/json'
			},
			body: JSON.stringify({ card_data: validCardPayload })
		});

		const res = await POST({ request } as unknown as RequestEvent);
		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error).toBe('Invalid device secret');
	});

	it('returns 200 on successful scan with valid headers and payload', async () => {
		const secret = 'sk_scan_correct_secret';
		const secretHash = await hashSecret(secret);

		mockGetDevice.mockResolvedValue({
			_id: 'device:01',
			type: 'scanner_device',
			schema_v: 1,
			created_at: '2026-08-30T00:00:00Z',
			updated_at: '2026-08-30T00:00:00Z',
			created_by: 'admin',
			device_id: 'DEV-01',
			name: 'จุดสแกน 1',
			shelter_code: 'SH001',
			station_name: 'โต๊ะ 1',
			secret_hash: secretHash,
			secret_prefix: 'sk_scan_corr...',
			status: 'active',
			last_seen_at: null
		});

		mockProcessScan.mockResolvedValue({
			status: 'created_pre_registered',
			evacuee: {
				_id: 'evacuee:01',
				created_at: '2026-08-30T00:00:00Z'
			} as unknown as Evacuee,
			message: 'อ่านบัตรสำเร็จ'
		});

		const request = new Request('http://localhost/api/v1/scanner/draft', {
			method: 'POST',
			headers: {
				'x-device-id': 'DEV-01',
				'x-device-secret': secret,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ card_data: validCardPayload })
		});

		const res = await POST({ request } as unknown as RequestEvent);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.status).toBe('created_pre_registered');
		expect(data.evacuee_id).toBe('evacuee:01');
	});
});
