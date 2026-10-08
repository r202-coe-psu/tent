import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { ServiceError, authorizeUserWrite } from '$lib/server/couch-admin';
import {
	ScannerConflictError,
	ScannerDeviceNotFoundError
} from '$lib/server/scanners/device-credentials';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import { StaffPinUnavailableError } from '$lib/server/scanners/staff-pin-store';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, authorizeUserWrite: vi.fn() };
});

vi.mock('$lib/server/scanners/device-repository', () => ({
	scannerDeviceRepository: { setStaffPin: vi.fn(), regenerateStaffPin: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

const DEVICE_ID = 'scanner_device:kiosk-01';

describe('POST /api/v1/scanner/devices/[id]/staff-pin', () => {
	const mockAuthorize = vi.mocked(authorizeUserWrite);
	const mockSet = vi.mocked(scannerDeviceRepository.setStaffPin);
	const mockRegenerate = vi.mocked(scannerDeviceRepository.regenerateStaffPin);

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockAuthorize.mockResolvedValue({
			name: 'sa-user',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		mockSet.mockResolvedValue();
		mockRegenerate.mockResolvedValue('582047');
	});

	async function post(body: unknown): Promise<Response> {
		return POST({
			params: { id: DEVICE_ID },
			request: new Request(`http://localhost/api/v1/scanner/devices/x/staff-pin`, {
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
		expect(mockSet).toHaveBeenCalledWith(DEVICE_ID, '482913', 'sa-user');
	});

	it('regenerates and returns the new PIN only to the caller', async () => {
		const response = await post({ regenerate: true });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, pin: '582047' });
		expect(mockRegenerate).toHaveBeenCalledWith(DEVICE_ID, 'sa-user');
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

	it('returns 403 for a shelter manager and 401 for anonymous', async () => {
		mockAuthorize.mockResolvedValueOnce({
			name: 'manager',
			roles: ['shelter_manager', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		expect((await post({ pin: '482913' })).status).toBe(403);

		mockAuthorize.mockRejectedValueOnce(
			new ServiceError('UNAUTHENTICATED', 'Authentication required')
		);
		expect((await post({ pin: '482913' })).status).toBe(401);
		expect(mockSet).not.toHaveBeenCalled();
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
