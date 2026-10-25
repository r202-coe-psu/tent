import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import {
	authenticateScannerDevice,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import {
	KioskReprintNotFoundError,
	KioskReprintUnverifiableError,
	KioskReprintVerifyFailedError,
	reprintKioskLabels
} from '$lib/features/kiosk/server/kiosk-reprint.server';
import { KioskLookupUnavailableError } from '$lib/features/kiosk/server/kiosk-check-in.server';
import { findMasterByCode } from '$lib/server/shelters.admin';

vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));

vi.mock('$lib/features/kiosk-devices/server', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/kiosk-devices/server')>(
		'$lib/features/kiosk-devices/server'
	);
	return { ...actual, scannerServerRepository: { updateDeviceLastSeen: vi.fn() } };
});

vi.mock('$lib/features/kiosk/server/kiosk-reprint.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/features/kiosk/server/kiosk-reprint.server')
	>('$lib/features/kiosk/server/kiosk-reprint.server');
	return { ...actual, reprintKioskLabels: vi.fn() };
});

vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockReprint = vi.mocked(reprintKioskLabels);
const mockFindShelter = vi.mocked(findMasterByCode);
const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const members = [
	{
		evacuee_id: primaryId,
		qr_payload: primaryId,
		label: { name: 'สมชาย ใจดี', phone: '0812345678', zone: null, stations_passed: 1 }
	}
];
const validBody = {
	phone: '0812345678',
	primary_evacuee_id: primaryId,
	id_last4: '0123',
	evacuee_ids: [primaryId]
};

function request(body: unknown, deviceId = 'reprint-device-1'): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/kiosk/reprint', {
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

const send = (body: unknown, deviceId?: string) => POST(request(body, deviceId));

describe('POST /api/v1/kiosk/reprint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return { registry_id: deviceId, shelter_code: 'SH001' } as never;
		});
		vi.mocked(scannerServerRepository.updateDeviceLastSeen).mockResolvedValue(undefined);
		mockReprint.mockResolvedValue(members);
		mockFindShelter.mockResolvedValue({
			code: 'SH001',
			feature_flags: { kiosk_phone_check_in_enabled: true }
		} as never);
	});

	it('rejects an unauthenticated device', async () => {
		const response = await send(validBody, '');
		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('DEVICE_AUTH_FAILED');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockReprint).not.toHaveBeenCalled();
	});

	it('rejects when the shelter has disabled the phone method', async () => {
		mockFindShelter.mockResolvedValueOnce({ code: 'SH001', feature_flags: {} } as never);
		const response = await send(validBody);
		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('KIOSK_METHOD_DISABLED');
		expect(mockReprint).not.toHaveBeenCalled();
	});

	it.each([
		['malformed json', '{nope'],
		['a bad last4', { ...validBody, id_last4: '12' }],
		['no members', { ...validBody, evacuee_ids: [] }]
	])('answers 400 for %s', async (_label, body) => {
		const response = await send(body);
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('INVALID_REPRINT_INPUT');
		expect(mockReprint).not.toHaveBeenCalled();
	});

	it('answers 400 when the phone is not a Thai number', async () => {
		const response = await send({ ...validBody, phone: '12345' });
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('INVALID_REPRINT_INPUT');
		expect(mockReprint).not.toHaveBeenCalled();
	});

	it('returns the labels with the device shelter and no-store', async () => {
		const response = await send(validBody);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ shelter_code: 'SH001', members });
		expect(mockReprint).toHaveBeenCalledWith('SH001', validBody, {
			verifyStaffPin: expect.any(Function)
		});
	});

	it('answers 404 KIOSK_REPRINT_NOT_FOUND', async () => {
		mockReprint.mockRejectedValueOnce(new KioskReprintNotFoundError());
		const response = await send(validBody);
		expect(response.status).toBe(404);
		expect((await response.json()).error.code).toBe('KIOSK_REPRINT_NOT_FOUND');
	});

	it('answers 403 KIOSK_REPRINT_UNVERIFIABLE', async () => {
		mockReprint.mockRejectedValueOnce(new KioskReprintUnverifiableError());
		const response = await send(validBody);
		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('KIOSK_REPRINT_UNVERIFIABLE');
	});

	it('answers 403 KIOSK_REPRINT_VERIFY_FAILED on a wrong last-4', async () => {
		mockReprint.mockRejectedValueOnce(new KioskReprintVerifyFailedError());
		const response = await send(validBody);
		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('KIOSK_REPRINT_VERIFY_FAILED');
	});

	it('answers 503 DEPENDENCY_UNAVAILABLE when CouchDB is down', async () => {
		mockReprint.mockRejectedValueOnce(new KioskLookupUnavailableError());
		const response = await send(validBody);
		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
	});
});
