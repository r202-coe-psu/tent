import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, PATCH } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/couch-admin';
import {
	ScannerConflictError,
	ScannerDependencyError,
	ScannerDeviceNotFoundError
} from '$lib/server/scanners/device-credentials';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import { StaffPinUnavailableError } from '$lib/server/scanners/staff-pin-store';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/scanners/device-repository', () => ({
	scannerDeviceRepository: { getDevice: vi.fn(), deleteDevice: vi.fn(), updateDevice: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

/** `[id]` is the device_id; the repository gets the registry doc `_id`. */
const DEVICE_ID = 'kiosk-01';
const DOC_ID = 'scanner_device:kiosk-01';

describe('DELETE /api/v1/kiosk/devices/[id]', () => {
	const mockSession = vi.mocked(readSessionUserCtx);
	const mockGet = vi.mocked(scannerDeviceRepository.getDevice);
	const mockDelete = vi.mocked(scannerDeviceRepository.deleteDevice);
	let info: ReturnType<typeof vi.spyOn>;

	/** Only `shelter_code` matters to the route; the repository is mocked. */
	function deviceIn(shelter_code: string) {
		return { _id: DOC_ID, device_id: DEVICE_ID, shelter_code } as Awaited<
			ReturnType<typeof scannerDeviceRepository.getDevice>
		>;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		info = vi.spyOn(console, 'info').mockImplementation(() => {});
		mockSession.mockResolvedValue(SESSIONS.admin);
		mockGet.mockResolvedValue(deviceIn('SH001'));
		mockDelete.mockResolvedValue();
	});

	async function del(id = DEVICE_ID): Promise<Response> {
		return DELETE({
			params: { id },
			request: new Request('http://localhost/api/v1/kiosk/devices/x', {
				method: 'DELETE',
				headers: { cookie: 'AuthSession=sa' }
			})
		} as unknown as RequestEvent);
	}

	it('deletes the device (and its PIN) as the SA', async () => {
		const response = await del();
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ ok: true });
		expect(mockDelete).toHaveBeenCalledWith(DOC_ID);
	});

	it('takes the device_id in the path: a doc _id or junk is 404 without touching the registry', async () => {
		for (const id of ['scanner_device:kiosk-01', '../x', '']) {
			const response = await del(id);
			expect(response.status).toBe(404);
		}
		expect(mockGet).not.toHaveBeenCalled();
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it('returns 401 for anonymous and 403 for registration staff without deleting', async () => {
		mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
		const anonymous = await del();
		expect(anonymous.status).toBe(401);
		expect(anonymous.headers.get('cache-control')).toBe('no-store');

		mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
		expect((await del()).status).toBe(403);
		expect(mockGet).not.toHaveBeenCalled();
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it('returns 403 when pr_staff deletes a device without touching the registry', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await del()).status).toBe(403);
		expect(mockGet).not.toHaveBeenCalled();
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it('lets a shelter manager delete a device of their own shelter and logs shelter and actor', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		expect((await del()).status).toBe(200);
		expect(mockDelete).toHaveBeenCalledWith(DOC_ID);
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain('[scanner-device] deleted device=kiosk-01 shelter=SH001');
		expect(logged).toContain('by=sm-a');
	});

	it('reads a device of another shelter as missing (404) and never deletes it', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue(deviceIn('SH002'));
		const response = await del();
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it('lets kiosk_staff delete in their own shelter and reads another as missing', async () => {
		mockSession.mockResolvedValue(SESSIONS.kioskA);
		expect((await del()).status).toBe(200);
		expect(info.mock.calls.flat().join(' ')).toContain('by=kiosk-a');
		mockGet.mockResolvedValue(deviceIn('SH002'));
		expect((await del()).status).toBe(404);
		expect(mockDelete).toHaveBeenCalledTimes(1);
	});

	it('lets a manager of both shelters and a system admin delete in either', async () => {
		for (const session of [SESSIONS.managerAB, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			mockGet.mockResolvedValue(deviceIn('SH002'));
			expect((await del()).status).toBe(200);
		}
		expect(mockDelete).toHaveBeenCalledTimes(2);
	});

	it('maps unknown → 404, conflict → 409, store down → 503', async () => {
		mockGet.mockRejectedValueOnce(new ScannerDeviceNotFoundError());
		expect((await del()).status).toBe(404);

		mockDelete.mockRejectedValueOnce(new ScannerConflictError('modified'));
		expect((await del()).status).toBe(409);

		mockDelete.mockRejectedValueOnce(new StaffPinUnavailableError());
		expect((await del()).status).toBe(503);
	});
});

describe('PATCH /api/v1/kiosk/devices/[id]', () => {
	const mockSession = vi.mocked(readSessionUserCtx);
	const mockGet = vi.mocked(scannerDeviceRepository.getDevice);
	const mockUpdate = vi.mocked(scannerDeviceRepository.updateDevice);

	type Persisted = Awaited<ReturnType<typeof scannerDeviceRepository.getDevice>>;

	function persisted(shelter_code: string, overrides: Record<string, unknown> = {}): Persisted {
		return {
			_id: DOC_ID,
			_rev: '2-a',
			type: 'scanner_device',
			schema_v: 1,
			created_at: '2026-09-22T00:00:00Z',
			updated_at: '2026-09-22T00:00:00Z',
			created_by: 'sa-user',
			device_id: DEVICE_ID,
			name: 'จุดคัดกรอง 1',
			shelter_code,
			station_name: 'โต๊ะ 1',
			status: 'active',
			secret_hash: 'a'.repeat(64),
			secret_prefix: 'sk_scan_aaaaaaaa...',
			last_seen_at: null,
			...overrides
		} as Persisted;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.admin);
		mockGet.mockResolvedValue(persisted('SH001'));
		mockUpdate.mockResolvedValue(persisted('SH001', { status: 'inactive' }));
	});

	async function patch(body: unknown, id = DEVICE_ID): Promise<Response> {
		return PATCH({
			params: { id },
			request: new Request('http://localhost/api/v1/kiosk/devices/x', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json', cookie: 'AuthSession=abc' },
				body: typeof body === 'string' ? body : JSON.stringify(body)
			})
		} as unknown as RequestEvent);
	}

	it('updates status as a system admin and returns only the redacted summary', async () => {
		const response = await patch({ status: 'inactive' });
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockUpdate).toHaveBeenCalledWith(DOC_ID, { status: 'inactive' }, 'sa-user');
		const data = await response.json();
		expect(data).toEqual({
			id: DOC_ID,
			device_id: DEVICE_ID,
			name: 'จุดคัดกรอง 1',
			shelter_code: 'SH001',
			station_name: 'โต๊ะ 1',
			status: 'inactive',
			last_seen_at: null,
			staff_pin_set: false,
			staff_pin_is_default: false,
			banner_group_id: null,
			screen_type: 'compact'
		});
		expect(JSON.stringify(data)).not.toContain('secret_hash');
	});

	it('persists screen_type=portrait and returns it in the summary', async () => {
		mockUpdate.mockResolvedValueOnce(persisted('SH001', { screen_type: 'portrait' }));
		const response = await patch({ screen_type: 'portrait' });
		expect(response.status).toBe(200);
		expect(mockUpdate).toHaveBeenCalledWith(DOC_ID, { screen_type: 'portrait' }, 'sa-user');
		expect(await response.json()).toMatchObject({ device_id: DEVICE_ID, screen_type: 'portrait' });
	});

	it('returns 401 for anonymous and 403 for registration staff without touching the device', async () => {
		mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
		const anonymous = await patch({ status: 'inactive' });
		expect(anonymous.status).toBe(401);
		expect(anonymous.headers.get('cache-control')).toBe('no-store');

		mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
		expect((await patch({ status: 'inactive' })).status).toBe(403);
		expect(mockGet).not.toHaveBeenCalled();
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('returns 403 when pr_staff updates a device without touching the registry', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await patch({ name: 'เครื่องใหม่' })).status).toBe(403);
		expect(mockGet).not.toHaveBeenCalled();
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('lets a shelter manager update a device of their own shelter as themselves', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		expect((await patch({ name: 'เครื่องใหม่' })).status).toBe(200);
		expect(mockUpdate).toHaveBeenCalledWith(DOC_ID, { name: 'เครื่องใหม่' }, 'sm-a');
	});

	it('reads a device of another shelter as missing (404) and never writes it', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue(persisted('SH002'));
		const response = await patch({ status: 'inactive' });
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('lets kiosk_staff update in their own shelter and reads another as missing', async () => {
		mockSession.mockResolvedValue(SESSIONS.kioskA);
		expect((await patch({ name: 'เครื่องใหม่' })).status).toBe(200);
		expect(mockUpdate).toHaveBeenCalledWith(DOC_ID, { name: 'เครื่องใหม่' }, 'kiosk-a');
		mockGet.mockResolvedValue(persisted('SH002'));
		expect((await patch({ status: 'inactive' })).status).toBe(404);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});

	it('lets a manager of both shelters and a system admin update in either', async () => {
		for (const session of [SESSIONS.managerAB, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			mockGet.mockResolvedValue(persisted('SH002'));
			expect((await patch({ status: 'inactive' })).status).toBe(200);
		}
		expect(mockUpdate).toHaveBeenCalledTimes(2);
	});

	it.each([
		['empty', {}],
		['unknown status', { status: 'paused' }],
		['shelter change', { shelter_code: 'SH002' }],
		['device id change', { device_id: 'other-01' }],
		['PIN metadata', { staff_pin_set: true }],
		['blank name', { name: ' ' }],
		['banner_enabled (retired)', { banner_enabled: false }],
		['banner_group_id (assigned from the group side)', { banner_group_id: 'kiosk_banner_group:a' }],
		['unknown screen_type', { screen_type: 'wide' }],
		['not an object', 'not json']
	])('returns 400 for a %s body before reading the device', async (_label, body) => {
		const response = await patch(body);
		expect(response.status).toBe(400);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockGet).not.toHaveBeenCalled();
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('treats a junk path id as 404 without reading the registry', async () => {
		expect((await patch({ status: 'inactive' }, '../x')).status).toBe(404);
		expect(mockGet).not.toHaveBeenCalled();
	});

	it('maps unknown → 404, rev conflict → 409, store down → 503', async () => {
		mockGet.mockRejectedValueOnce(new ScannerDeviceNotFoundError());
		expect((await patch({ status: 'inactive' })).status).toBe(404);

		mockUpdate.mockRejectedValueOnce(new ScannerConflictError('modified'));
		expect((await patch({ status: 'inactive' })).status).toBe(409);

		mockUpdate.mockRejectedValueOnce(new ScannerDependencyError());
		expect((await patch({ status: 'inactive' })).status).toBe(503);
	});
});
