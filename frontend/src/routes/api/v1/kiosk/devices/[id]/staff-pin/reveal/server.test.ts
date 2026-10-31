import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/couch-admin';
import { ScannerDeviceNotFoundError } from '$lib/server/scanners/device-credentials';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import {
	StaffPinNotSetError,
	StaffPinUnavailableError
} from '$lib/server/scanners/staff-pin-store';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/scanners/device-repository', () => ({
	scannerDeviceRepository: { getDevice: vi.fn(), revealStaffPin: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

/** `[id]` is the device_id; the repository gets the registry doc `_id`. */
const DEVICE_ID = 'kiosk-01';
const DOC_ID = 'scanner_device:kiosk-01';

describe('POST /api/v1/kiosk/devices/[id]/staff-pin/reveal', () => {
	const mockSession = vi.mocked(readSessionUserCtx);
	const mockGet = vi.mocked(scannerDeviceRepository.getDevice);
	const mockReveal = vi.mocked(scannerDeviceRepository.revealStaffPin);
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
		mockReveal.mockResolvedValue({
			pin: '482913',
			is_default: true,
			updated_at: '2026-10-08T00:00:00Z',
			updated_by: 'sa-user'
		});
	});

	async function post(): Promise<Response> {
		return POST({
			params: { id: DEVICE_ID },
			request: new Request('http://localhost/api/v1/kiosk/devices/x/staff-pin/reveal', {
				method: 'POST',
				headers: { cookie: 'AuthSession=sa' }
			})
		} as unknown as RequestEvent);
	}

	it('reveals the PIN to SA with no-store and logs who/which device without the PIN', async () => {
		const response = await post();

		expect(response.status).toBe(200);
		expect(mockReveal).toHaveBeenCalledWith(DOC_ID);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('pragma')).toBe('no-cache');
		expect(await response.json()).toEqual({
			pin: '482913',
			is_default: true,
			updated_at: '2026-10-08T00:00:00Z',
			updated_by: 'sa-user'
		});
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain('revealed');
		expect(logged).toContain(DEVICE_ID);
		expect(logged).toContain('sa-user');
		expect(logged).not.toContain('482913');
	});

	it('returns 401 for anonymous and 403 for registration staff without touching the device', async () => {
		mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
		const anonymous = await post();
		expect(anonymous.status).toBe(401);
		expect(anonymous.headers.get('cache-control')).toBe('no-store');

		mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
		const forbidden = await post();
		expect(forbidden.status).toBe(403);
		expect(forbidden.headers.get('cache-control')).toBe('no-store');
		expect(mockGet).not.toHaveBeenCalled();
		expect(mockReveal).not.toHaveBeenCalled();
	});

	it('lets a shelter manager reveal the PIN of a device in their own shelter and logs shelter and actor', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		const response = await post();
		expect(response.status).toBe(200);
		expect(mockReveal).toHaveBeenCalledWith(DOC_ID);
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain('[scanner-staff-pin] revealed device=kiosk-01 shelter=SH001');
		expect(logged).toContain('by=sm-a');
		expect(logged).not.toContain('482913');
	});

	it('reads a device of another shelter as missing (404) and never reveals its PIN', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue(deviceIn('SH002'));
		const response = await post();
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.text()).not.toContain('482913');
		expect(mockReveal).not.toHaveBeenCalled();
	});

	it('lets kiosk_staff reveal in their own shelter and reads another as missing', async () => {
		mockSession.mockResolvedValue(SESSIONS.kioskA);
		expect((await post()).status).toBe(200);
		mockGet.mockResolvedValue(deviceIn('SH002'));
		expect((await post()).status).toBe(404);
		expect(mockReveal).toHaveBeenCalledTimes(1);
	});

	it('lets pr_staff reveal in their own shelter, logged under their name, and reads another as missing', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await post()).status).toBe(200);
		expect(mockReveal).toHaveBeenCalledWith(DOC_ID);
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain('by=pr-a');
		expect(logged).not.toContain('482913');
		mockGet.mockResolvedValue(deviceIn('SH002'));
		expect((await post()).status).toBe(404);
		expect(mockReveal).toHaveBeenCalledTimes(1);
	});

	it('lets a manager of both shelters and a system admin reveal in either', async () => {
		for (const session of [SESSIONS.managerAB, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			mockGet.mockResolvedValue(deviceIn('SH002'));
			expect((await post()).status).toBe(200);
		}
		expect(mockReveal).toHaveBeenCalledTimes(2);
	});

	it('maps not set → 409, unknown → 404, store down → 503', async () => {
		mockReveal.mockRejectedValueOnce(new StaffPinNotSetError());
		const notSet = await post();
		expect(notSet.status).toBe(409);
		expect((await notSet.json()).error.code).toBe('staff_pin_not_set');

		mockReveal.mockRejectedValueOnce(new ScannerDeviceNotFoundError());
		expect((await post()).status).toBe(404);

		mockReveal.mockRejectedValueOnce(new StaffPinUnavailableError());
		expect((await post()).status).toBe(503);
	});
});
