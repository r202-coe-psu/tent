import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE } from './+server';
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
	scannerDeviceRepository: { deleteDevice: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

const DEVICE_ID = 'scanner_device:kiosk-01';

describe('DELETE /api/v1/scanner/devices/[id]', () => {
	const mockAuthorize = vi.mocked(authorizeUserWrite);
	const mockDelete = vi.mocked(scannerDeviceRepository.deleteDevice);

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'info').mockImplementation(() => {});
		mockAuthorize.mockResolvedValue({
			name: 'sa-user',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		mockDelete.mockResolvedValue();
	});

	async function del(): Promise<Response> {
		return DELETE({
			params: { id: DEVICE_ID },
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
		expect(mockDelete).toHaveBeenCalledWith(DEVICE_ID);
	});

	it('returns 403 for non-SA and 401 for anonymous without deleting', async () => {
		mockAuthorize.mockResolvedValueOnce({
			name: 'manager',
			roles: ['shelter_manager', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		expect((await del()).status).toBe(403);

		mockAuthorize.mockRejectedValueOnce(
			new ServiceError('UNAUTHENTICATED', 'Authentication required')
		);
		expect((await del()).status).toBe(401);
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it('maps unknown → 404, conflict → 409, store down → 503', async () => {
		mockDelete.mockRejectedValueOnce(new ScannerDeviceNotFoundError());
		expect((await del()).status).toBe(404);

		mockDelete.mockRejectedValueOnce(new ScannerConflictError('modified'));
		expect((await del()).status).toBe(409);

		mockDelete.mockRejectedValueOnce(new StaffPinUnavailableError());
		expect((await del()).status).toBe(503);
	});
});
