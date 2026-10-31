import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
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
	scannerDeviceRepository: { getDevice: vi.fn(), setStaffPin: vi.fn(), regenerateStaffPin: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

/** `[id]` is the device_id; the repository gets the registry doc `_id`. */
const DEVICE_ID = 'kiosk-01';
const DOC_ID = 'scanner_device:kiosk-01';

describe('POST /api/v1/kiosk/devices/[id]/staff-pin', () => {
	const mockSession = vi.mocked(readSessionUserCtx);
	const mockGet = vi.mocked(scannerDeviceRepository.getDevice);
	const mockSet = vi.mocked(scannerDeviceRepository.setStaffPin);
	const mockRegenerate = vi.mocked(scannerDeviceRepository.regenerateStaffPin);

	/** Only `shelter_code` matters to the route; the repository is mocked. */
	function deviceIn(shelter_code: string) {
		return { _id: DOC_ID, device_id: DEVICE_ID, shelter_code } as Awaited<
			ReturnType<typeof scannerDeviceRepository.getDevice>
		>;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockSession.mockResolvedValue(SESSIONS.admin);
		mockGet.mockResolvedValue(deviceIn('SH001'));
		mockSet.mockResolvedValue();
		mockRegenerate.mockResolvedValue('582047');
	});

	async function post(body: unknown): Promise<Response> {
		return POST({
			params: { id: DEVICE_ID },
			request: new Request(`http://localhost/api/v1/kiosk/devices/x/staff-pin`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: 'AuthSession=sa' },
				body: JSON.stringify(body)
			})
		} as unknown as RequestEvent);
	}

	it('sets a chosen PIN as the SA and does not echo it', async () => {
		const response = await post({ pin: '482913' });

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ ok: true });
		expect(mockSet).toHaveBeenCalledWith(DOC_ID, '482913', 'sa-user');
	});

	it('regenerates and returns the new PIN only to the caller', async () => {
		const response = await post({ regenerate: true });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, pin: '582047' });
		expect(mockRegenerate).toHaveBeenCalledWith(DOC_ID, 'sa-user');
		expect(mockSet).not.toHaveBeenCalled();
	});

	it('never logs the PIN', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		await post({ pin: '482913' });
		await post({ regenerate: true });
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain(DEVICE_ID);
		expect(logged).toContain('sa-user');
		expect(logged).not.toContain('482913');
		expect(logged).not.toContain('582047');
	});

	it('returns 401 for anonymous and 403 for registration staff without touching the device', async () => {
		mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
		const anonymous = await post({ pin: '482913' });
		expect(anonymous.status).toBe(401);
		expect(anonymous.headers.get('cache-control')).toBe('no-store');

		mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
		expect((await post({ pin: '482913' })).status).toBe(403);
		expect(mockGet).not.toHaveBeenCalled();
		expect(mockSet).not.toHaveBeenCalled();
	});

	it('returns 403 when pr_staff sets or regenerates a PIN without touching the device', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await post({ pin: '482913' })).status).toBe(403);
		expect((await post({ regenerate: true })).status).toBe(403);
		expect(mockGet).not.toHaveBeenCalled();
		expect(mockSet).not.toHaveBeenCalled();
		expect(mockRegenerate).not.toHaveBeenCalled();
	});

	it('lets a shelter manager set and regenerate a PIN of their own shelter, recorded under their name', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		expect((await post({ pin: '482913' })).status).toBe(200);
		expect(mockSet).toHaveBeenCalledWith(DOC_ID, '482913', 'sm-a');

		expect((await post({ regenerate: true })).status).toBe(200);
		expect(mockRegenerate).toHaveBeenCalledWith(DOC_ID, 'sm-a');
	});

	it('reads a device of another shelter as missing (404) and writes no PIN', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue(deviceIn('SH002'));
		const response = await post({ pin: '482913' });
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await post({ regenerate: true })).status).toBe(404);
		expect(mockSet).not.toHaveBeenCalled();
		expect(mockRegenerate).not.toHaveBeenCalled();
	});

	it('lets kiosk_staff set a PIN in their own shelter, recorded under their name', async () => {
		mockSession.mockResolvedValue(SESSIONS.kioskA);
		expect((await post({ pin: '482913' })).status).toBe(200);
		expect(mockSet).toHaveBeenCalledWith(DOC_ID, '482913', 'kiosk-a');
		mockGet.mockResolvedValue(deviceIn('SH002'));
		expect((await post({ pin: '482913' })).status).toBe(404);
		expect(mockSet).toHaveBeenCalledTimes(1);
	});

	it('lets a manager of both shelters and a system admin set a PIN in either', async () => {
		for (const session of [SESSIONS.managerAB, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			mockGet.mockResolvedValue(deviceIn('SH002'));
			expect((await post({ pin: '482913' })).status).toBe(200);
		}
		expect(mockSet).toHaveBeenCalledTimes(2);
	});

	it('logs the shelter with the actor', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		mockSession.mockResolvedValue(SESSIONS.managerA);
		await post({ pin: '482913' });
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain('[scanner-staff-pin] set device=kiosk-01 shelter=SH001 by=sm-a');
	});

	it.each([
		['malformed', { pin: '48291' }],
		['trivial', { pin: '123456' }],
		['repeated', { pin: '000000' }],
		['both fields', { pin: '482913', regenerate: true }],
		['empty', {}],
		['regenerate false', { regenerate: false }]
	])('returns 400 for a %s body', async (_label, body) => {
		const response = await post(body);
		expect(response.status).toBe(400);
		expect(mockSet).not.toHaveBeenCalled();
		expect(mockRegenerate).not.toHaveBeenCalled();
	});

	it('maps unknown device, rev conflict, and an unreachable PIN store', async () => {
		mockSet.mockRejectedValueOnce(new ScannerDeviceNotFoundError());
		expect((await post({ pin: '482913' })).status).toBe(404);

		mockSet.mockRejectedValueOnce(new ScannerConflictError('modified'));
		expect((await post({ pin: '482913' })).status).toBe(409);

		mockSet.mockRejectedValueOnce(new StaffPinUnavailableError());
		const response = await post({ pin: '482913' });
		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});
