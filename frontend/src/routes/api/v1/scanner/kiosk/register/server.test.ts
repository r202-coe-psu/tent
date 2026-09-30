import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import {
	authenticateScannerDevice,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { ServiceError } from '$lib/server/couch-admin';
import {
	KioskRegistrationBlockedError,
	registerKioskWalkIn
} from '$lib/features/kiosk/server/kiosk-register.server';
import { kioskRegisterDeviceLimiter } from '$lib/server/security/rate-limiter';

const { mockUpdateLastSeen } = vi.hoisted(() => ({
	mockUpdateLastSeen: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/features/scanners/server', () => ({
	scannerServerRepository: {
		updateDeviceLastSeen: (...args: unknown[]) => mockUpdateLastSeen(...args)
	}
}));
vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));
vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});
vi.mock('$lib/features/kiosk/server/kiosk-register.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/features/kiosk/server/kiosk-register.server')
	>('$lib/features/kiosk/server/kiosk-register.server');
	return { ...actual, registerKioskWalkIn: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockFindShelter = vi.mocked(findMasterByCode);
const mockRegister = vi.mocked(registerKioskWalkIn);

function request(body: unknown, includeHeaders = true): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/scanner/kiosk/register', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(includeHeaders ? { 'x-device-id': 'KIOSK-01', 'x-device-secret': 'secret' } : {})
			},
			body: JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

const validBody = {
	card: { citizen_id: '1234567890123', first_name_th: 'สมชาย', gender: 'male' },
	consented: true,
	consented_at: new Date().toISOString()
};

describe('POST /api/v1/scanner/kiosk/register', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		vi.spyOn(kioskRegisterDeviceLimiter, 'check').mockReturnValue(true);
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return {
				shelter_code: 'SH001',
				device_id: 'KIOSK-01',
				station_name: 'โต๊ะ 1',
				registry_id: 'registry:KIOSK-01'
			} as never;
		});
		mockFindShelter.mockResolvedValue({
			feature_flags: { kiosk_walk_in_registration_enabled: true }
		} as never);
		mockRegister.mockResolvedValue({ _id: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV' } as never);
	});

	it('creates a record only under the authenticated shelter and disables caching', async () => {
		const response = await POST(request(validBody));
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			status: 'created',
			evacuee_id: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV'
		});
		expect(mockRegister).toHaveBeenCalledWith(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			expect.objectContaining({ citizen_id: validBody.card.citizen_id }),
			null,
			validBody.consented_at
		);
		expect(mockUpdateLastSeen).toHaveBeenCalledWith('registry:KIOSK-01');
	});

	it('fails closed when walk-in registration is disabled', async () => {
		mockFindShelter.mockResolvedValue({
			feature_flags: { kiosk_walk_in_registration_enabled: false }
		} as never);
		const response = await POST(request(validBody));
		expect(response.status).toBe(403);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('requires explicit consent and a valid timestamp', async () => {
		const response = await POST(request({ ...validBody, consented: false }));
		expect(response.status).toBe(400);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('rejects card photo data left inside card instead of the separate payload', async () => {
		const response = await POST(
			request({
				...validBody,
				card: { ...validBody.card, photo_base64: 'data:image/jpeg;base64,AA==' }
			})
		);
		expect(response.status).toBe(400);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('rejects photo MIME mismatches before attempting registration', async () => {
		const response = await POST(
			request({
				...validBody,
				photo: {
					content_type: 'image/webp',
					full_base64: '/9j/AA==',
					width: 1,
					height: 1,
					original_size: 4,
					compressed_size: 4,
					thumbnail_size: 0
				}
			})
		);
		expect(response.status).toBe(400);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('returns 400 when the consent timestamp is stale', async () => {
		const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
		const response = await POST(request({ ...validBody, consented_at: stale }));
		expect(response.status).toBe(400);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('returns 429 when the authenticated device exceeds its registration limit', async () => {
		vi.mocked(kioskRegisterDeviceLimiter.check).mockReturnValue(false);
		const response = await POST(request(validBody));
		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('returns conflict when the citizen has an existing record', async () => {
		mockRegister.mockRejectedValue(new KioskRegistrationBlockedError());
		const response = await POST(request(validBody));
		expect(response.status).toBe(409);
		expect((await response.json()).error.code).toBe('KIOSK_REGISTRATION_BLOCKED');
	});

	it('reports the shelter registry as unavailable separately from a write failure', async () => {
		mockFindShelter.mockRejectedValue(new ServiceError('INTERNAL', 'Could not read registry'));
		const response = await POST(request(validBody));
		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
		expect(mockRegister).not.toHaveBeenCalled();
	});
});
