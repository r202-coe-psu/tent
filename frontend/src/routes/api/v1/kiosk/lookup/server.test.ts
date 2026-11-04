import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError
} from '$lib/server/scanners/device-credentials';
import { lookupPreRegisteredEvacuee } from '$lib/features/kiosk/server/kiosk-check-in.server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { isKioskThaidCheckInAllowed } from '$lib/features/kiosk/server/kiosk-thaid-gate.server';
import {
	_resetSessionsForTest,
	cancelKioskSession,
	completeKioskSession,
	createKioskCheckInSession,
	getKioskSessionForDevice
} from '$lib/server/thaid-scan-session';

vi.mock('$lib/features/kiosk/server/kiosk-thaid-gate.server', () => ({
	isKioskThaidCheckInAllowed: vi.fn()
}));

vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));

vi.mock('$lib/features/kiosk-devices/server', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/kiosk-devices/server')>(
		'$lib/features/kiosk-devices/server'
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
const mockFindShelter = vi.mocked(findMasterByCode);
const mockThaidAllowed = vi.mocked(isKioskThaidCheckInAllowed);
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
		request: new Request('http://localhost/api/v1/kiosk/lookup', {
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

describe('POST /api/v1/kiosk/lookup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return principalFor(deviceId) as never;
		});
		mockHeartbeat.mockResolvedValue(undefined);
		mockLookup.mockResolvedValue(household as never);
		mockThaidAllowed.mockResolvedValue(true);
		_resetSessionsForTest();
		mockFindShelter.mockResolvedValue({
			code: 'SH001',
			feature_flags: {
				kiosk_phone_check_in_enabled: true,
				kiosk_walk_in_registration_enabled: true
			}
		} as never);
	});

	it('rejects phone lookup when its authenticated shelter has disabled the method', async () => {
		mockFindShelter.mockResolvedValueOnce({ code: 'SH001', feature_flags: {} } as never);

		const response = await send({ source: 'phone', phone });

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('KIOSK_METHOD_DISABLED');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('does not read the shelter flag for QR or matched smart-card lookups', async () => {
		const response = await send({ source: 'qr', token: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV' });

		expect(response.status).toBe(200);
		const cardResponse = await send({ source: 'smart-card', citizen_id: '1234567890123' });
		expect(cardResponse.status).toBe(200);
		expect(mockFindShelter).not.toHaveBeenCalled();
	});

	it('checks the walk-in flag only after a smart-card miss', async () => {
		mockLookup.mockResolvedValueOnce({ kind: 'not_found', can_register: true } as never);

		const response = await send({ source: 'smart-card', citizen_id: '1234567890123' });

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ can_register: true });
		expect(mockFindShelter).toHaveBeenCalledTimes(1);
	});

	it('fails closed for walk-in registration if the shelter registry is unavailable', async () => {
		mockLookup.mockResolvedValueOnce({ kind: 'not_found', can_register: true } as never);
		mockFindShelter.mockRejectedValueOnce(new Error('registry unavailable'));

		const response = await send({ source: 'smart-card', citizen_id: '1234567890123' });

		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ can_register: false });
	});

	it('returns 503 when the shelter registry cannot be read for phone lookups', async () => {
		mockFindShelter.mockRejectedValueOnce(new Error('registry unavailable'));

		const response = await send({ source: 'phone', phone });

		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe(DEPENDENCY_UNAVAILABLE);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockLookup).not.toHaveBeenCalled();
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
});

describe('POST /api/v1/kiosk/lookup source thaid', () => {
	const pid = '1234567890123';
	const device = 'thaid-kiosk-a';

	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return principalFor(deviceId) as never;
		});
		mockHeartbeat.mockResolvedValue(undefined);
		mockLookup.mockResolvedValue(household as never);
		mockThaidAllowed.mockResolvedValue(true);
		_resetSessionsForTest();
	});

	function completedSession(deviceId = device): string {
		const session = createKioskCheckInSession({ device_id: deviceId, shelter_code: 'SH001' });
		completeKioskSession(session.id, { pid, sub: 'sub-1' });
		return session.id;
	}

	const sessionInvalid = {
		error: {
			code: 'KIOSK_THAID_SESSION_INVALID',
			message: 'การยืนยัน ThaiD หมดอายุหรือไม่ถูกต้อง กรุณาสแกนใหม่'
		}
	};

	it('rejects when the ThaiD gate is off, before touching the session', async () => {
		mockThaidAllowed.mockResolvedValueOnce(false);
		const sessionId = completedSession();

		const response = await send({ source: 'thaid', session_id: sessionId }, device);

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('KIOSK_METHOD_DISABLED');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockThaidAllowed).toHaveBeenCalledWith('SH001');
		expect(mockLookup).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(sessionId, device)?.status).toBe('completed');
	});

	it('rejects a browser-supplied citizen id with thaid', async () => {
		const response = await send(
			{ source: 'thaid', session_id: completedSession(), citizen_id: pid },
			device
		);

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('INVALID_GATE_INPUT');
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('answers 409 for an unknown session', async () => {
		const response = await send({ source: 'thaid', session_id: 'f'.repeat(32) }, device);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual(sessionInvalid);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('answers 409 for a session still pending', async () => {
		const pending = createKioskCheckInSession({ device_id: device, shelter_code: 'SH001' });

		const response = await send({ source: 'thaid', session_id: pending.id }, device);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual(sessionInvalid);
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('answers 409 for a cancelled session', async () => {
		const sessionId = completedSession();
		cancelKioskSession(sessionId, device);

		const response = await send({ source: 'thaid', session_id: sessionId }, device);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual(sessionInvalid);
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('answers 409 when another kiosk presents the session (AC-04)', async () => {
		const sessionId = completedSession('thaid-kiosk-a');

		const response = await send({ source: 'thaid', session_id: sessionId }, 'thaid-kiosk-b');

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual(sessionInvalid);
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('answers 409 when the session is bound to another shelter than the kiosk', async () => {
		const session = createKioskCheckInSession({ device_id: device, shelter_code: 'SH002' });
		completeKioskSession(session.id, { pid, sub: 'sub-1' });

		const response = await send({ source: 'thaid', session_id: session.id }, device);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual(sessionInvalid);
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('looks up by the session citizen id, leaks no pid, and keeps the session usable', async () => {
		const sessionId = completedSession();

		const response = await send({ source: 'thaid', session_id: sessionId }, device);
		const text = await response.text();

		expect(response.status).toBe(200);
		expect(JSON.parse(text)).toMatchObject(household);
		expect(text).not.toContain(pid);
		expect(mockLookup).toHaveBeenCalledWith('SH001', { source: 'thaid', citizen_id: pid });
		expect(getKioskSessionForDevice(sessionId, device)?.status).toBe('completed');
		expect((await send({ source: 'thaid', session_id: sessionId }, device)).status).toBe(200);
	});

	it('answers 404 without a walk-in offer when the citizen is not pre-registered (AC-03)', async () => {
		mockLookup.mockResolvedValueOnce({ kind: 'not_found', can_register: false } as never);

		const response = await send({ source: 'thaid', session_id: completedSession() }, device);
		const text = await response.text();

		expect(response.status).toBe(404);
		expect(JSON.parse(text)).toMatchObject({
			can_register: false,
			error: { code: 'PRE_REGISTRATION_NOT_FOUND' }
		});
		expect(text).not.toContain(pid);
		expect(mockFindShelter).not.toHaveBeenCalled();
	});

	it('offers a walk-in for a ThaiD miss and extends the verified session once', async () => {
		mockLookup.mockResolvedValue({ kind: 'not_found', can_register: true } as never);
		mockFindShelter.mockResolvedValue({
			code: 'SH001',
			feature_flags: { kiosk_walk_in_registration_enabled: true }
		} as never);
		const sessionId = completedSession();
		const before = getKioskSessionForDevice(sessionId, device)!.expiresAt;

		const response = await send({ source: 'thaid', session_id: sessionId }, device);
		const text = await response.text();

		expect(response.status).toBe(404);
		expect(JSON.parse(text)).toMatchObject({ can_register: true });
		expect(text).not.toContain(pid);
		const session = getKioskSessionForDevice(sessionId, device);
		expect(session?.status).toBe('completed');
		expect(session?.registrationExtended).toBe(true);
		expect(session!.expiresAt).toBeGreaterThanOrEqual(before);
	});

	it('neither offers a walk-in nor extends the session when walk-in is off', async () => {
		mockLookup.mockResolvedValue({ kind: 'not_found', can_register: true } as never);
		mockFindShelter.mockResolvedValue({ code: 'SH001', feature_flags: {} } as never);
		const sessionId = completedSession();

		const response = await send({ source: 'thaid', session_id: sessionId }, device);

		expect(await response.json()).toMatchObject({ can_register: false });
		expect(getKioskSessionForDevice(sessionId, device)?.registrationExtended).toBeUndefined();
	});
});
