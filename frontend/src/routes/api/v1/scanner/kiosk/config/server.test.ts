import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import {
	authenticateScannerDevice,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import { findMasterByCode } from '$lib/server/shelters.admin';

vi.mock('$lib/features/scanners/server', () => ({ scannerServerRepository: {} }));
vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));
vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockFindShelter = vi.mocked(findMasterByCode);

function request(body: unknown = {}, headers: Record<string, string> = {}): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/scanner/kiosk/config', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

describe('POST /api/v1/scanner/kiosk/config', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return { shelter_code: 'SH001' } as never;
		});
		mockFindShelter.mockResolvedValue({
			code: 'SH001',
			feature_flags: { kiosk_phone_check_in_enabled: true }
		} as never);
	});

	it('returns the authenticated shelter flag without trusting the request body', async () => {
		const response = await POST(
			request({ shelter_code: 'SH999' }, { 'x-device-id': 'device-1', 'x-device-secret': 'secret' })
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			shelter_code: 'SH001',
			phone_check_in_enabled: true
		});
		expect(mockFindShelter).toHaveBeenCalledWith('SH001');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('pragma')).toBe('no-cache');
	});

	it.each([
		['missing feature flag', { code: 'SH001', feature_flags: {} }],
		['missing shelter', null]
	])('defaults to disabled for %s', async (_label, shelter) => {
		mockFindShelter.mockResolvedValueOnce(shelter as never);
		const response = await POST(
			request({}, { 'x-device-id': 'device-1', 'x-device-secret': 'secret' })
		);

		expect(response.status).toBe(200);
		expect((await response.json()).phone_check_in_enabled).toBe(false);
	});

	it('returns 401 when authentication fails', async () => {
		mockAuthenticate.mockRejectedValueOnce(new ScannerAuthError());
		const response = await POST(request());

		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('DEVICE_AUTH_FAILED');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockFindShelter).not.toHaveBeenCalled();
	});

	it('returns 503 when registry lookup fails', async () => {
		mockFindShelter.mockRejectedValueOnce(new Error('registry unavailable'));
		const response = await POST(
			request({}, { 'x-device-id': 'device-1', 'x-device-secret': 'secret' })
		);

		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});
