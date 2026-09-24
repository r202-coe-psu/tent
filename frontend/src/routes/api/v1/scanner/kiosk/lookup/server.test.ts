import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError
} from '$lib/server/scanners/device-credentials';
import { lookupPreRegisteredEvacuee } from '$lib/features/kiosk/server/kiosk-check-in.server';

vi.mock('$lib/features/scanners/server', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/scanners/server')>(
		'$lib/features/scanners/server'
	);
	return {
		...actual,
		scannerServerRepository: { updateDeviceLastSeen: vi.fn() }
	};
});

vi.mock('$lib/features/kiosk/server/kiosk-check-in.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/features/kiosk/server/kiosk-check-in.server')
	>('$lib/features/kiosk/server/kiosk-check-in.server');
	return { ...actual, lookupPreRegisteredEvacuee: vi.fn() };
});

vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockLookup = vi.mocked(lookupPreRegisteredEvacuee);
const mockHeartbeat = vi.mocked(scannerServerRepository.updateDeviceLastSeen);
const phone = '0812345678';
const principalFor = (registryId: string) => ({ registry_id: registryId, shelter_code: 'SH001' });
const household = {
	kind: 'household' as const,
	name_masked: true,
	shelter_code: 'SH001',
	primary_evacuee_id: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV',
	members: []
};

function request(
	body: unknown,
	deviceId = 'test-kiosk-device',
	secret = 'test-secret'
): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/scanner/kiosk/lookup', {
			method: 'POST',
			headers: {
				...(deviceId ? { 'x-device-id': deviceId } : {}),
				...(secret ? { 'x-device-secret': secret } : {}),
				'content-type': 'application/json'
			},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

async function send(body: unknown, deviceId?: string): Promise<Response> {
	return POST(request(body, deviceId));
}

function phoneFor(index: number): string {
	return `08123456${String(index).padStart(2, '0')}`;
}

describe('POST /api/v1/scanner/kiosk/lookup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return principalFor(deviceId) as never;
		});
		mockHeartbeat.mockResolvedValue(undefined);
		mockLookup.mockResolvedValue(household as never);
	});

	it('returns a no-store 401 when device authentication fails', async () => {
		const response = await POST(request({ source: 'phone', phone }, ''));
		const data = await response.json();
		expect(response.status).toBe(401);
		expect(data.error.code).toBe(DEVICE_AUTH_FAILED);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('returns 503 when the credential service is unavailable', async () => {
		mockAuthenticate.mockRejectedValueOnce(new ScannerDependencyError());
		const response = await send({ source: 'phone', phone });
		const data = await response.json();
		expect(response.status).toBe(503);
		expect(data.error.code).toBe(DEPENDENCY_UNAVAILABLE);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it.each(['not json', { source: 'unknown' }, { source: 'phone', phone: '12345' }])(
		'returns 400 for malformed or invalid gate input (%s)',
		async (body) => {
			const response = await send(body);
			expect(response.status).toBe(400);
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(mockLookup).not.toHaveBeenCalled();
		}
	);

	it.each([
		['household', household, 200],
		['candidates', { kind: 'candidates', shelter_code: 'SH001', candidates: [] }, 200],
		['not found', { kind: 'not_found' }, 404],
		['too many', { kind: 'too_many' }, 409]
	] as const)(
		'maps %s lookup results and applies no-store headers',
		async (_label, result, status) => {
			mockLookup.mockResolvedValueOnce(result as never);
			const response = await send({ source: 'phone', phone });
			expect(response.status).toBe(status);
			expect(response.headers.get('cache-control')).toBe('no-store');
			if (status === 200) expect(await response.json()).toMatchObject(result);
			else
				expect((await response.json()).error.code).toBe(
					status === 404 ? 'PRE_REGISTRATION_NOT_FOUND' : 'KIOSK_TOO_MANY_MATCHES'
				);
		}
	);

	it('limits each device to ten phone searches per minute without consuming another phone bucket on denial', async () => {
		const deviceId = 'kph-device-limit-test';
		for (let index = 0; index < 10; index += 1) {
			expect((await send({ source: 'phone', phone: phoneFor(index) }, deviceId)).status).toBe(200);
		}
		const blocked = await send({ source: 'phone', phone: '0899991001' }, deviceId);
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get('retry-after')).toBe('60');
		expect(blocked.headers.get('cache-control')).toBe('no-store');

		for (let index = 0; index < 5; index += 1) {
			expect(
				(await send({ source: 'phone', phone: '0899991001' }, `kph-other-device-${index}`)).status
			).toBe(200);
		}
		expect((await send({ source: 'phone', phone: '0899991001' }, 'kph-final-device')).status).toBe(
			429
		);
	});

	it('limits one normalized phone across devices', async () => {
		const sharedPhone = '0888884001';
		for (let index = 0; index < 5; index += 1) {
			expect(
				(await send({ source: 'phone', phone: sharedPhone }, `kph-shared-device-${index}`)).status
			).toBe(200);
		}
		const blocked = await send({ source: 'phone', phone: sharedPhone }, 'kph-shared-device-six');
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get('retry-after')).toBe('60');
	});

	it('skips the per-phone limit when selecting a household but keeps the per-device limit', async () => {
		const sharedPhone = '0877773001';
		for (let index = 0; index < 5; index += 1) {
			expect(
				(await send({ source: 'phone', phone: sharedPhone }, `kph-selection-search-${index}`))
					.status
			).toBe(200);
		}

		const selection = {
			source: 'phone',
			phone: sharedPhone,
			primary_evacuee_id: household.primary_evacuee_id
		};
		const deviceId = 'kph-selection-device-limit';
		for (let index = 0; index < 10; index += 1) {
			expect((await send(selection, deviceId)).status).toBe(200);
		}
		const blocked = await send(selection, deviceId);
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get('retry-after')).toBe('60');
		expect(mockLookup).toHaveBeenCalledWith('SH001', selection);
	});

	it('does not rate limit card lookups', async () => {
		for (let index = 0; index < 12; index += 1) {
			const response = await send(
				{ source: 'smart-card', citizen_id: '1234567890123' },
				'kph-card-device'
			);
			expect(response.status).toBe(200);
		}
		expect(mockLookup).toHaveBeenCalledTimes(12);
	});
});
