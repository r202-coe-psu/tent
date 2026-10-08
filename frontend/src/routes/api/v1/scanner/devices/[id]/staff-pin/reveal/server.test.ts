import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { authorizeUserWrite } from '$lib/server/couch-admin';
import { ScannerDeviceNotFoundError } from '$lib/server/scanners/device-credentials';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import {
	StaffPinNotSetError,
	StaffPinUnavailableError
} from '$lib/server/scanners/staff-pin-store';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, authorizeUserWrite: vi.fn() };
});

vi.mock('$lib/server/scanners/device-repository', () => ({
	scannerDeviceRepository: { revealStaffPin: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

const DEVICE_ID = 'scanner_device:kiosk-01';

describe('POST /api/v1/scanner/devices/[id]/staff-pin/reveal', () => {
	const mockAuthorize = vi.mocked(authorizeUserWrite);
	const mockReveal = vi.mocked(scannerDeviceRepository.revealStaffPin);
	let info: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		info = vi.spyOn(console, 'info').mockImplementation(() => {});
		mockAuthorize.mockResolvedValue({
			name: 'sa-user',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
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
			request: new Request('http://localhost/api/v1/scanner/devices/x/staff-pin/reveal', {
				method: 'POST',
				headers: { cookie: 'AuthSession=sa' }
			})
		} as unknown as RequestEvent);
	}

	it('reveals the PIN to SA with no-store and logs who/which device without the PIN', async () => {
		const response = await post();

		expect(response.status).toBe(200);
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

	it('returns 403 for a non-SA caller without touching the repository', async () => {
		mockAuthorize.mockResolvedValueOnce({
			name: 'manager',
			roles: ['shelter_manager', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		const response = await post();
		expect(response.status).toBe(403);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockReveal).not.toHaveBeenCalled();
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
