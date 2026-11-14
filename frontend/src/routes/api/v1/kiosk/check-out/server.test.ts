import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import {
	checkOutSelectedMembers,
	KioskCheckOutIdentityMismatchError
} from '$lib/features/kiosk/server/kiosk-check-out.server';
import { isKioskThaidCheckInAllowed } from '$lib/features/kiosk/server/kiosk-thaid-gate.server';
import {
	_resetSessionsForTest,
	cancelKioskSession,
	completeKioskSession,
	createKioskCheckInSession,
	getKioskSessionForDevice
} from '$lib/server/thaid-scan-session';
import {
	authenticateScannerDevice,
	ScannerAuthError,
	ScannerDependencyError
} from '$lib/server/scanners/device-credentials';

vi.mock('$lib/features/kiosk-devices/server', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/kiosk-devices/server')>(
		'$lib/features/kiosk-devices/server'
	);
	return {
		...actual,
		scannerServerRepository: { updateDeviceLastSeen: vi.fn() }
	};
});

vi.mock('$lib/features/kiosk/server/kiosk-check-out.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/features/kiosk/server/kiosk-check-out.server')
	>('$lib/features/kiosk/server/kiosk-check-out.server');
	return { ...actual, checkOutSelectedMembers: vi.fn() };
});

vi.mock('$lib/features/kiosk/server/kiosk-thaid-gate.server', () => ({
	isKioskThaidCheckInAllowed: vi.fn()
}));

vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockCheckOut = vi.mocked(checkOutSelectedMembers);
const mockThaidAllowed = vi.mocked(isKioskThaidCheckInAllowed);
const mockHeartbeat = vi.mocked(scannerServerRepository.updateDeviceLastSeen);
const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const memberId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAW';
const principal = {
	registry_id: 'device-record-1',
	device_id: 'test-kiosk-device',
	name: 'Kiosk Lobby',
	shelter_code: 'SH001'
};
const citizenId = '1234567890123';

function request(body: unknown, deviceId = 'test-kiosk-device'): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/kiosk/check-out', {
			method: 'POST',
			headers: {
				...(deviceId ? { 'x-device-id': deviceId } : {}),
				'x-device-secret': 'test-secret',
				'content-type': 'application/json'
			},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

async function send(body: unknown, deviceId?: string): Promise<Response> {
	return POST(request(body, deviceId));
}

const checkedOut = [
	{ evacuee_id: primaryId, status: 'checked_out', stay_status: 'checked_out' }
] as never;

beforeEach(() => {
	vi.clearAllMocks();
	mockAuthenticate.mockImplementation(async (deviceId) => {
		if (!deviceId) throw new ScannerAuthError();
		return principal as never;
	});
	mockCheckOut.mockResolvedValue(checkedOut);
	mockHeartbeat.mockResolvedValue(undefined);
	mockThaidAllowed.mockResolvedValue(true);
	_resetSessionsForTest();
});

describe('POST /api/v1/kiosk/check-out source smart-card', () => {
	const body = (extra: Record<string, unknown> = {}) => ({
		primary_evacuee_id: primaryId,
		evacuee_ids: [primaryId, memberId],
		source: 'smart-card',
		citizen_id: citizenId,
		destination_type: 'returned_home',
		...extra
	});

	it('authenticates the device, checks members out, and returns no-store results', async () => {
		const response = await send(body());

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			shelter_code: 'SH001',
			members: [{ evacuee_id: primaryId, status: 'checked_out', stay_status: 'checked_out' }]
		});
		expect(mockCheckOut).toHaveBeenCalledWith('SH001', primaryId, [primaryId, memberId], {
			requiredPrimaryCitizenId: citizenId,
			deviceId: 'test-kiosk-device',
			deviceLabel: 'Kiosk Lobby',
			destinationType: 'returned_home'
		});
		expect(mockHeartbeat).toHaveBeenCalledWith('device-record-1');
	});

	it('labels the movement with the device id when the device has no name', async () => {
		mockAuthenticate.mockResolvedValueOnce({ ...principal, name: '  ' } as never);

		await send(body());

		expect(mockCheckOut).toHaveBeenCalledWith(
			'SH001',
			primaryId,
			expect.any(Array),
			expect.objectContaining({ deviceLabel: 'test-kiosk-device' })
		);
	});

	it('answers 401 without device credentials', async () => {
		const response = await send(body(), '');

		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('DEVICE_AUTH_FAILED');
		expect(mockCheckOut).not.toHaveBeenCalled();
	});

	it('answers 503 when the device registry is unavailable', async () => {
		mockAuthenticate.mockRejectedValueOnce(new ScannerDependencyError());

		const response = await send(body());

		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
	});

	it.each([
		['not JSON', 'nope'],
		['no members', body({ evacuee_ids: [] })],
		['a qr source', body({ source: 'qr' })],
		['a card without citizen_id', body({ citizen_id: undefined })],
		['a destination staff must record', body({ destination_type: 'transferred_shelter' })],
		['no destination', body({ destination_type: undefined })]
	])('answers 400 for %s', async (_label, input) => {
		const response = await send(input);

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('INVALID_CHECK_OUT_INPUT');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockCheckOut).not.toHaveBeenCalled();
	});

	it('answers 409 when the card is not the primary', async () => {
		mockCheckOut.mockRejectedValueOnce(new KioskCheckOutIdentityMismatchError());

		const response = await send(body());

		expect(response.status).toBe(409);
		expect((await response.json()).error.code).toBe('KIOSK_CHECK_OUT_IDENTITY_MISMATCH');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockHeartbeat).not.toHaveBeenCalled();
	});

	it('answers 500 for an unexpected failure', async () => {
		mockCheckOut.mockRejectedValueOnce(new Error('database unavailable'));

		const response = await send(body());

		expect(response.status).toBe(500);
		expect((await response.json()).error.code).toBe('KIOSK_CHECK_OUT_FAILED');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

describe('POST /api/v1/kiosk/check-out source thaid', () => {
	const sessionInvalid = {
		error: {
			code: 'KIOSK_THAID_SESSION_INVALID',
			message: 'การยืนยัน ThaiD หมดอายุหรือไม่ถูกต้อง กรุณาสแกนใหม่'
		}
	};

	function completedSession(deviceId = principal.registry_id): string {
		const session = createKioskCheckInSession({ device_id: deviceId, shelter_code: 'SH001' });
		completeKioskSession(session.id, { pid: citizenId, sub: 'sub-1' });
		return session.id;
	}

	const body = (sessionId: string, extra: Record<string, unknown> = {}) => ({
		primary_evacuee_id: primaryId,
		evacuee_ids: [primaryId, memberId],
		source: 'thaid',
		thaid_session_id: sessionId,
		destination_type: 'other',
		...extra
	});

	it('rejects when the ThaiD gate is off and leaves the session untouched', async () => {
		mockThaidAllowed.mockResolvedValueOnce(false);
		const sessionId = completedSession();

		const response = await send(body(sessionId));

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('KIOSK_METHOD_DISABLED');
		expect(mockThaidAllowed).toHaveBeenCalledWith('SH001');
		expect(mockCheckOut).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('completed');
	});

	it('rejects a browser-supplied citizen id with 400 before touching the session', async () => {
		const sessionId = completedSession();

		const response = await send(body(sessionId, { citizen_id: citizenId }));

		expect(response.status).toBe(400);
		expect(mockCheckOut).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('completed');
	});

	it("answers 409 for a session that is cancelled, unknown or another kiosk's", async () => {
		const cancelled = completedSession();
		cancelKioskSession(cancelled, principal.registry_id);

		expect((await send(body(cancelled))).status).toBe(409);
		expect((await send(body('e'.repeat(32)))).status).toBe(409);
		expect((await send(body(completedSession('another-device-record')))).status).toBe(409);
		expect(mockCheckOut).not.toHaveBeenCalled();
	});

	it('answers 409 for a session bound to another shelter and leaves it untouched', async () => {
		const session = createKioskCheckInSession({
			device_id: principal.registry_id,
			shelter_code: 'SH002'
		});
		completeKioskSession(session.id, { pid: citizenId, sub: 'sub-1' });

		const response = await send(body(session.id));

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual(sessionInvalid);
		expect(mockCheckOut).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(session.id, principal.registry_id)?.status).toBe('completed');
	});

	it('checks out with the session citizen required on the primary, then consumes the session', async () => {
		const sessionId = completedSession();

		const response = await send(body(sessionId));
		const text = await response.text();

		expect(response.status).toBe(200);
		expect(JSON.parse(text).members).toHaveLength(1);
		expect(text).not.toContain(citizenId);
		expect(mockCheckOut).toHaveBeenCalledWith('SH001', primaryId, [primaryId, memberId], {
			requiredPrimaryCitizenId: citizenId,
			deviceId: 'test-kiosk-device',
			deviceLabel: 'Kiosk Lobby',
			destinationType: 'other'
		});
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('consumed');
		expect(mockHeartbeat).toHaveBeenCalledWith('device-record-1');
	});

	it('answers 409 when the same session is replayed', async () => {
		const sessionId = completedSession();
		expect((await send(body(sessionId))).status).toBe(200);

		const replay = await send(body(sessionId));

		expect(replay.status).toBe(409);
		expect(await replay.json()).toEqual(sessionInvalid);
		expect(mockCheckOut).toHaveBeenCalledTimes(1);
	});

	it('answers 409 session-invalid when the primary is not the verified citizen', async () => {
		mockCheckOut.mockRejectedValueOnce(new KioskCheckOutIdentityMismatchError());
		const sessionId = completedSession();

		const response = await send(body(sessionId));
		const text = await response.text();

		expect(response.status).toBe(409);
		expect(JSON.parse(text)).toEqual(sessionInvalid);
		expect(text).not.toContain(citizenId);
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('consumed');
	});

	it('releases the session when the write throws so the same scan can be retried', async () => {
		mockCheckOut.mockRejectedValueOnce(new Error('database unavailable'));
		const sessionId = completedSession();

		const failed = await send(body(sessionId));

		expect(failed.status).toBe(500);
		expect((await failed.json()).error.code).toBe('KIOSK_CHECK_OUT_FAILED');
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('completed');
		expect((await send(body(sessionId))).status).toBe(200);
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('consumed');
	});

	it.each([
		['every write failed', 'failed'],
		['nobody could be checked out', 'not_eligible']
	])('releases the session when %s', async (_label, status) => {
		mockCheckOut.mockResolvedValueOnce([
			{ evacuee_id: primaryId, status },
			{ evacuee_id: memberId, status }
		] as never);
		const sessionId = completedSession();

		const response = await send(body(sessionId));

		expect(response.status).toBe(200);
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('completed');
	});

	it('keeps the session consumed when at least one member was checked out', async () => {
		mockCheckOut.mockResolvedValueOnce([
			{ evacuee_id: primaryId, status: 'checked_out', stay_status: 'checked_out' },
			{ evacuee_id: memberId, status: 'failed' }
		] as never);
		const sessionId = completedSession();

		expect((await send(body(sessionId))).status).toBe(200);
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('consumed');
	});
});
