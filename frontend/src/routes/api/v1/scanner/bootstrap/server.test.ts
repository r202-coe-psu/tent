import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import { hashScannerSecret, ScannerDependencyError } from '$lib/server/scanners/device-credentials';
import { findMasterByCode } from '$lib/server/shelters.admin';

vi.mock('$lib/features/scanners/server', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/scanners/server')>(
		'$lib/features/scanners/server'
	);
	return {
		...actual,
		scannerServerRepository: {
			getDeviceByDeviceId: vi.fn(),
			updateDeviceLastSeen: vi.fn()
		}
	};
});

vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: vi.fn()
}));

describe('POST /api/v1/scanner/bootstrap', () => {
	const mockGetDevice = vi.mocked(scannerServerRepository.getDeviceByDeviceId);
	const mockHeartbeat = vi.mocked(scannerServerRepository.updateDeviceLastSeen);
	const mockFindShelter = vi.mocked(findMasterByCode);
	const secret = 'sk_scan_bootstrap_secret';

	const device = (status: 'active' | 'inactive' = 'active') => ({
		_id: 'scanner_device:kiosk-sh001-01',
		_rev: '1-a',
		type: 'scanner_device' as const,
		schema_v: 1 as const,
		created_at: '2026-09-22T00:00:00Z',
		updated_at: '2026-09-22T00:00:00Z',
		created_by: 'sa-user',
		device_id: 'kiosk-sh001-01',
		name: 'จุดคัดกรอง 1',
		shelter_code: 'SH001',
		station_name: 'โต๊ะ 1',
		secret_hash: hashScannerSecret(secret),
		secret_prefix: 'sk_scan_01234567...',
		status,
		last_seen_at: null
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockHeartbeat.mockResolvedValue(undefined);
		mockFindShelter.mockResolvedValue({ code: 'SH001', name: 'ศูนย์พักพิงทดสอบ' } as never);
	});

	function request(deviceId = 'kiosk-sh001-01', scannerSecret = secret): RequestEvent {
		return {
			request: new Request('http://localhost/api/v1/scanner/bootstrap', {
				method: 'POST',
				headers: {
					'x-device-id': deviceId,
					'x-device-secret': scannerSecret,
					'content-type': 'application/json'
				},
				body: JSON.stringify({ client_version: 'test' })
			})
		} as unknown as RequestEvent;
	}

	it('uses the same 401 body for missing, unknown, wrong, and inactive credentials', async () => {
		const responses: Array<{ status: number; body: unknown }> = [];

		const missing = await POST(request('kiosk-sh001-01', ''));
		responses.push({ status: missing.status, body: await missing.json() });

		mockGetDevice.mockResolvedValueOnce(null);
		const unknown = await POST(request());
		responses.push({ status: unknown.status, body: await unknown.json() });

		mockGetDevice.mockResolvedValueOnce(device());
		const wrong = await POST(request('kiosk-sh001-01', 'sk_scan_wrong'));
		responses.push({ status: wrong.status, body: await wrong.json() });

		mockGetDevice.mockResolvedValueOnce(device('inactive'));
		const inactive = await POST(request());
		responses.push({ status: inactive.status, body: await inactive.json() });

		expect(responses.every((response) => response.status === 401)).toBe(true);
		expect(responses.map((response) => response.body)).toEqual([
			responses[0].body,
			responses[0].body,
			responses[0].body,
			responses[0].body
		]);
	});

	it('returns a safe bootstrap principal and records a heartbeat for valid credentials', async () => {
		mockGetDevice.mockResolvedValue(device());

		const response = await POST(request());
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(data.device).toEqual({
			device_id: 'kiosk-sh001-01',
			name: 'จุดคัดกรอง 1',
			shelter_code: 'SH001',
			shelter_name: 'ศูนย์พักพิงทดสอบ',
			station_name: 'โต๊ะ 1',
			status: 'active',
			last_seen_at: null
		});
		expect(data.device).not.toHaveProperty('secret_hash');
		expect(data.device).not.toHaveProperty('_rev');
		expect(mockHeartbeat).toHaveBeenCalledWith('scanner_device:kiosk-sh001-01');
	});

	it('returns 503 for malformed stored data and dependency failures', async () => {
		mockGetDevice.mockResolvedValue({ ...device(), secret_hash: 'not-a-sha256-hash' });
		expect((await POST(request())).status).toBe(503);

		mockGetDevice.mockRejectedValue(new ScannerDependencyError());
		expect((await POST(request())).status).toBe(503);
	});
});
