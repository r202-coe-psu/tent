import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import {
	authenticateScannerDevice,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import {
	KioskVolunteerCardNotFoundError,
	resolveKioskVolunteerCard
} from '$lib/features/kiosk/server/kiosk-volunteer-card.server';
import { KioskLookupUnavailableError } from '$lib/features/kiosk/server/kiosk-check-in.server';
import { findMasterByCode } from '$lib/server/shelters.admin';

vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));

vi.mock('$lib/features/kiosk-devices/server', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/kiosk-devices/server')>(
		'$lib/features/kiosk-devices/server'
	);
	return { ...actual, scannerServerRepository: { updateDeviceLastSeen: vi.fn() } };
});

vi.mock('$lib/features/kiosk/server/kiosk-volunteer-card.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/features/kiosk/server/kiosk-volunteer-card.server')
	>('$lib/features/kiosk/server/kiosk-volunteer-card.server');
	return { ...actual, resolveKioskVolunteerCard: vi.fn() };
});

vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockResolve = vi.mocked(resolveKioskVolunteerCard);
const mockFindShelter = vi.mocked(findMasterByCode);
const card = { display_name: 'สมชาย ใ***', volunteer_code: 'V-0001', qr_payload: 'volunteer:abc' };

function request(body: unknown, deviceId = 'vol-card-device-1'): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/kiosk/volunteer-card', {
			method: 'POST',
			headers: {
				...(deviceId ? { 'x-device-id': deviceId } : {}),
				'x-device-secret': 'secret',
				'content-type': 'application/json'
			},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

const uniquePhone = () => `09${String(10_000_000 + nonce).padStart(8, '0')}`;
const send = (body: unknown, deviceId?: string) => POST(request(body, deviceId));
let nonce = 0;

describe('POST /api/v1/kiosk/volunteer-card', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		nonce += 1;
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return { registry_id: `${deviceId}-${nonce}`, shelter_code: 'SH001' } as never;
		});
		vi.mocked(scannerServerRepository.updateDeviceLastSeen).mockResolvedValue(undefined);
		mockResolve.mockResolvedValue(card);
		mockFindShelter.mockResolvedValue({
			code: 'SH001',
			feature_flags: { kiosk_phone_check_in_enabled: true }
		} as never);
	});

	it('returns the role card for the device shelter and canonical phone with no-store', async () => {
		const response = await send({ phone: '081-234-5678' });
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ shelter_code: 'SH001', volunteer: card });
		expect(mockResolve).toHaveBeenCalledWith('SH001', '0812345678');
		expect(scannerServerRepository.updateDeviceLastSeen).toHaveBeenCalledWith(
			`vol-card-device-1-${nonce}`
		);
	});

	it('rejects an unauthenticated device', async () => {
		const response = await send({ phone: uniquePhone() }, '');
		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('DEVICE_AUTH_FAILED');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it.each([
		['malformed json', '{nope'],
		['a missing body', 'null'],
		['a non-string phone', { phone: 812345678 }],
		['a phone that is not a Thai number', { phone: '12345' }]
	])('answers 400 for %s', async (_label, body) => {
		const response = await send(body);
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('INVALID_VOLUNTEER_CARD_INPUT');
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it('rejects when the shelter has disabled the phone method', async () => {
		mockFindShelter.mockResolvedValueOnce({ code: 'SH001', feature_flags: {} } as never);
		const response = await send({ phone: uniquePhone() });
		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('KIOSK_METHOD_DISABLED');
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it('answers 404 KIOSK_VOLUNTEER_CARD_NOT_FOUND when no volunteer matches', async () => {
		mockResolve.mockRejectedValueOnce(new KioskVolunteerCardNotFoundError());
		const response = await send({ phone: uniquePhone() });
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: {
				code: 'KIOSK_VOLUNTEER_CARD_NOT_FOUND',
				message: 'ไม่พบข้อมูลจิตอาสาที่ใช้เบอร์นี้ในศูนย์นี้ กรุณาติดต่อเจ้าหน้าที่'
			}
		});
	});

	it('answers 503 DEPENDENCY_UNAVAILABLE when CouchDB is down', async () => {
		mockResolve.mockRejectedValueOnce(new KioskLookupUnavailableError());
		const response = await send({ phone: uniquePhone() });
		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
	});

	it('answers 503 DEPENDENCY_UNAVAILABLE when the shelter config cannot be read', async () => {
		mockFindShelter.mockRejectedValueOnce(new Error('couch down'));
		const response = await send({ phone: uniquePhone() });
		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
		expect(mockResolve).not.toHaveBeenCalled();
	});
});
