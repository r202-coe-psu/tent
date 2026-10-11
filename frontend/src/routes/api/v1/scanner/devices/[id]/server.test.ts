import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/couch-admin';
import {
	ScannerConflictError,
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
	scannerDeviceRepository: { getDevice: vi.fn(), deleteDevice: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

/** `[id]` is the device_id; the repository gets the registry doc `_id`. */
const DEVICE_ID = 'kiosk-01';
const DOC_ID = 'scanner_device:kiosk-01';

describe('DELETE /api/v1/scanner/devices/[id]', () => {
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
			request: new Request('http://localhost/api/v1/scanner/devices/x', {
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
