import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { ServiceError, authorizeUserWrite } from '$lib/server/couch-admin';
import {
	ScannerConflictError,
	ScannerDependencyError,
	ScannerShelterNotFoundError
} from '$lib/server/scanners/device-credentials';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, authorizeUserWrite: vi.fn() };
});

vi.mock('$lib/server/scanners/device-repository', () => ({
	scannerDeviceRepository: { createDevice: vi.fn() }
}));

describe('POST /api/v1/scanner/devices', () => {
	const mockAuthorize = vi.mocked(authorizeUserWrite);
	const mockCreate = vi.mocked(scannerDeviceRepository.createDevice);

	const input = {
		device_id: 'kiosk-sh001-01',
		name: 'จุดคัดกรอง 1',
		shelter_code: 'SH001',
		station_name: 'โต๊ะ 1',
		status: 'active' as const
	};

	const persisted = {
		_id: 'scanner_device:kiosk-sh001-01',
		_rev: '1-a',
		type: 'scanner_device' as const,
		schema_v: 1 as const,
		created_at: '2026-09-22T00:00:00Z',
		updated_at: '2026-09-22T00:00:00Z',
		created_by: 'sa-user',
		...input,
		secret_hash: 'a'.repeat(64),
		secret_prefix: 'sk_scan_aaaaaaaa...',
		last_seen_at: null
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthorize.mockResolvedValue({
			name: 'sa-user',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		mockCreate.mockResolvedValue({ device: persisted, plaintext_secret: 'sk_scan_one_time' });
	});

	async function post(body: unknown): Promise<Response> {
		return POST({
			request: new Request('http://localhost/api/v1/scanner/devices', {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: 'AuthSession=sa' },
				body: JSON.stringify(body)
			})
		} as unknown as RequestEvent);
	}

	it('returns 401 for an anonymous caller', async () => {
		mockAuthorize.mockRejectedValue(new ServiceError('UNAUTHENTICATED', 'Authentication required'));
		const response = await post(input);
		expect(response.status).toBe(401);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 403 for a non-system-admin caller', async () => {
		mockAuthorize.mockResolvedValue({
			name: 'manager',
			roles: ['shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		const response = await post(input);
		expect(response.status).toBe(403);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns a one-time secret and only a redacted device summary', async () => {
		const response = await post(input);
		const data = await response.json();

		expect(response.status).toBe(201);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(data.plaintext_secret).toBe('sk_scan_one_time');
		expect(data.device).toEqual({
			id: 'scanner_device:kiosk-sh001-01',
			device_id: 'kiosk-sh001-01',
			name: 'จุดคัดกรอง 1',
			shelter_code: 'SH001',
			station_name: 'โต๊ะ 1',
			status: 'active',
			last_seen_at: null
		});
		expect(data.device).not.toHaveProperty('secret_hash');
		expect(data.device).not.toHaveProperty('_rev');
	});

	it('rejects secret and actor fields from browser input', async () => {
		const response = await post({
			...input,
			plaintext_secret: 'attacker-secret',
			created_by: 'attacker'
		});
		expect(response.status).toBe(422);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('maps deterministic duplicate and dependency failures', async () => {
		mockCreate.mockRejectedValueOnce(new ScannerConflictError());
		expect((await post(input)).status).toBe(409);

		mockCreate.mockRejectedValueOnce(new ScannerShelterNotFoundError());
		expect((await post(input)).status).toBe(404);

		mockCreate.mockRejectedValueOnce(new ScannerDependencyError());
		expect((await post(input)).status).toBe(503);
	});
});
