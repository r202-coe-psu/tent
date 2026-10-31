import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/couch-admin';
import {
	ScannerConflictError,
	ScannerDependencyError,
	ScannerShelterNotFoundError
} from '$lib/server/scanners/device-credentials';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/scanners/device-repository', () => ({
	scannerDeviceRepository: { createDevice: vi.fn(), listDevices: vi.fn() }
}));

describe('POST /api/v1/kiosk/devices', () => {
	const mockSession = vi.mocked(readSessionUserCtx);
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
		mockSession.mockResolvedValue(SESSIONS.admin);
		mockCreate.mockResolvedValue({
			device: persisted,
			plaintext_secret: 'sk_scan_one_time',
			plaintext_staff_pin: '482913'
		});
	});

	async function post(body: unknown): Promise<Response> {
		return POST({
			request: new Request('http://localhost/api/v1/kiosk/devices', {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: 'AuthSession=sa' },
				body: JSON.stringify(body)
			})
		} as unknown as RequestEvent);
	}

	it('returns 401 for an anonymous caller', async () => {
		mockSession.mockResolvedValue(SESSIONS.anonymous);
		const response = await post(input);
		expect(response.status).toBe(401);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 403 for registration staff', async () => {
		mockSession.mockResolvedValue(SESSIONS.registrationA);
		const response = await post(input);
		expect(response.status).toBe(403);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('lets a shelter manager create in their own shelter as themselves', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		const response = await post(input);
		expect(response.status).toBe(201);
		expect(mockCreate).toHaveBeenCalledWith({ ...input, screen_type: 'compact' }, 'sm-a');
	});

	it('passes a chosen screen_type through to the repository', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		const response = await post({ ...input, screen_type: 'portrait' });
		expect(response.status).toBe(201);
		expect(mockCreate).toHaveBeenCalledWith({ ...input, screen_type: 'portrait' }, 'sm-a');
	});

	it('lets kiosk_staff create in their own shelter only (AC-SBO-19/20)', async () => {
		mockSession.mockResolvedValue(SESSIONS.kioskA);
		expect((await post(input)).status).toBe(201);
		expect(mockCreate).toHaveBeenCalledWith({ ...input, screen_type: 'compact' }, 'kiosk-a');
		expect((await post({ ...input, shelter_code: 'SH002' })).status).toBe(403);
		expect(mockCreate).toHaveBeenCalledTimes(1);
	});

	it('returns 403 when a shelter manager creates in another shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		const response = await post({ ...input, shelter_code: 'SH002' });
		expect(response.status).toBe(403);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 403 when pr_staff creates a device, even in their own shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await post(input)).status).toBe(403);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('lets a manager of both shelters and a system admin create in either', async () => {
		for (const session of [SESSIONS.managerAB, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			expect((await post(input)).status).toBe(201);
			expect((await post({ ...input, shelter_code: 'SH002' })).status).toBe(201);
		}
		expect(mockCreate).toHaveBeenCalledTimes(4);
	});

	it('logs the creation with shelter and actor but never the secret or PIN', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		mockSession.mockResolvedValue(SESSIONS.managerA);
		await post(input);
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain('[scanner-device] created device=kiosk-sh001-01 shelter=SH001');
		expect(logged).toContain('by=sm-a');
		expect(logged).not.toContain('sk_scan_one_time');
		expect(logged).not.toContain('482913');
		info.mockRestore();
	});

	it('returns a one-time secret and only a redacted device summary', async () => {
		const response = await post(input);
		const data = await response.json();

		expect(response.status).toBe(201);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(data.plaintext_secret).toBe('sk_scan_one_time');
		expect(data.plaintext_staff_pin).toBe('482913');
		expect(data.device).toEqual({
			id: 'scanner_device:kiosk-sh001-01',
			device_id: 'kiosk-sh001-01',
			name: 'จุดคัดกรอง 1',
			shelter_code: 'SH001',
			station_name: 'โต๊ะ 1',
			status: 'active',
			last_seen_at: null,
			staff_pin_set: false,
			staff_pin_is_default: false,
			banner_group_id: null,
			screen_type: 'compact'
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

describe('GET /api/v1/kiosk/devices', () => {
	const mockSession = vi.mocked(readSessionUserCtx);
	const mockList = vi.mocked(scannerDeviceRepository.listDevices);

	const deviceA = {
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
		status: 'active' as const,
		secret_hash: 'a'.repeat(64),
		secret_prefix: 'sk_scan_aaaaaaaa...',
		last_seen_at: null
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.admin);
		mockList.mockResolvedValue([deviceA]);
	});

	async function get(query = ''): Promise<Response> {
		return GET({
			url: new URL(`http://localhost/api/v1/kiosk/devices${query}`),
			request: new Request(`http://localhost/api/v1/kiosk/devices${query}`, {
				headers: { cookie: 'AuthSession=abc' }
			})
		} as unknown as RequestEvent);
	}

	it.each(['', '?shelter_code=SH001', '?shelter_code=SH002'])(
		'returns 401 for anonymous and 403 for registration staff (%s) without listing',
		async (query) => {
			mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
			const anonymous = await get(query);
			expect(anonymous.status).toBe(401);
			expect(anonymous.headers.get('cache-control')).toBe('no-store');

			mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
			expect((await get(query)).status).toBe(403);
			expect(mockList).not.toHaveBeenCalled();
		}
	);

	it('lists the requested shelter for a shelter manager as redacted summaries', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		const response = await get('?shelter_code=SH001');
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockList).toHaveBeenCalledWith(['SH001']);
		expect(await response.json()).toEqual([
			{
				id: 'scanner_device:kiosk-sh001-01',
				device_id: 'kiosk-sh001-01',
				name: 'จุดคัดกรอง 1',
				shelter_code: 'SH001',
				station_name: 'โต๊ะ 1',
				status: 'active',
				last_seen_at: null,
				staff_pin_set: false,
				staff_pin_is_default: false,
				banner_group_id: null,
				screen_type: 'compact'
			}
		]);
	});

	it('requires a shelter manager to name a shelter (400)', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		const response = await get();
		expect(response.status).toBe(400);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockList).not.toHaveBeenCalled();
	});

	it('returns 403 when a shelter manager asks for another shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		const response = await get('?shelter_code=SH002');
		expect(response.status).toBe(403);
		expect(mockList).not.toHaveBeenCalled();
	});

	it('lists the own shelter for kiosk_staff and 403 for another (AC-SBO-20)', async () => {
		mockSession.mockResolvedValue(SESSIONS.kioskA);
		expect((await get('?shelter_code=SH001')).status).toBe(200);
		expect(mockList).toHaveBeenCalledWith(['SH001']);
		expect((await get('?shelter_code=SH002')).status).toBe(403);
		expect(mockList).toHaveBeenCalledTimes(1);
	});

	it('lets pr_staff list their own shelter and returns 403 for another', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await get('?shelter_code=SH001')).status).toBe(200);
		expect(mockList).toHaveBeenCalledWith(['SH001']);
		const other = await get('?shelter_code=SH002');
		expect(other.status).toBe(403);
		expect((await other.json()).error.message).toContain('pr_staff');
		expect(mockList).toHaveBeenCalledTimes(1);
	});

	it('lists one shelter at a time for a manager of both', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerAB);
		expect((await get()).status).toBe(400);
		expect((await get('?shelter_code=SH001')).status).toBe(200);
		expect(mockList).toHaveBeenLastCalledWith(['SH001']);
		expect((await get('?shelter_code=SH002')).status).toBe(200);
		expect(mockList).toHaveBeenLastCalledWith(['SH002']);
	});

	it('lets a system admin list every shelter or filter to one', async () => {
		expect((await get()).status).toBe(200);
		expect(mockList).toHaveBeenLastCalledWith(null);
		expect((await get('?shelter_code=SH002')).status).toBe(200);
		expect(mockList).toHaveBeenLastCalledWith(['SH002']);
	});

	it('maps a registry outage to 503', async () => {
		mockList.mockRejectedValueOnce(new ScannerDependencyError());
		const response = await get();
		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});
