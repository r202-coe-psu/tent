import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import {
	checkInSelectedMembers,
	KioskThaidIdentityMismatchError,
	saveKioskCheckInCardPhoto
} from '$lib/features/kiosk/server/kiosk-check-in.server';
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
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError
} from '$lib/server/scanners/device-credentials';

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
	return { ...actual, checkInSelectedMembers: vi.fn(), saveKioskCheckInCardPhoto: vi.fn() };
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
const mockCheckIn = vi.mocked(checkInSelectedMembers);
const mockSavePhoto = vi.mocked(saveKioskCheckInCardPhoto);
const mockThaidAllowed = vi.mocked(isKioskThaidCheckInAllowed);
const mockHeartbeat = vi.mocked(scannerServerRepository.updateDeviceLastSeen);
const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const memberId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAW';
const principal = {
	registry_id: 'device-record-1',
	device_id: 'test-kiosk-device',
	shelter_code: 'SH001'
};
const citizenId = '1234567890123';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const photo = {
	content_type: 'image/jpeg',
	full_base64: jpeg.toString('base64'),
	width: 1,
	height: 1,
	original_size: jpeg.length,
	compressed_size: jpeg.length,
	thumbnail_size: 0
};

function request(body: unknown, deviceId = 'test-kiosk-device'): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/scanner/kiosk/check-in', {
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

describe('POST /api/v1/scanner/kiosk/check-in', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return principal as never;
		});
		mockCheckIn.mockResolvedValue([
			{ evacuee_id: primaryId, status: 'checked_in', qr_payload: primaryId }
		] as never);
		mockHeartbeat.mockResolvedValue(undefined);
		mockSavePhoto.mockResolvedValue('saved');
	});

	it('authenticates the device, checks in members, and returns no-store results', async () => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId, memberId]
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toMatchObject({
			shelter_code: 'SH001',
			members: [{ evacuee_id: primaryId, status: 'checked_in', qr_payload: primaryId }]
		});
		expect(mockCheckIn).toHaveBeenCalledWith('SH001', primaryId, [primaryId, memberId]);
		expect(mockHeartbeat).toHaveBeenCalledWith('device-record-1');
	});

	it('rejects more than twenty IDs before writing', async () => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: Array.from({ length: 21 }, () => primaryId)
		});
		expect(response.status).toBe(400);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('INVALID_CHECK_IN_INPUT');
		expect(mockCheckIn).not.toHaveBeenCalled();
	});

	it('maps device authentication failures to 401', async () => {
		const response = await POST(
			request({ primary_evacuee_id: primaryId, evacuee_ids: [primaryId] }, '')
		);
		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe(DEVICE_AUTH_FAILED);
	});

	it('maps credential-service outages to 503', async () => {
		mockAuthenticate.mockRejectedValueOnce(new ScannerDependencyError());
		const response = await send({ primary_evacuee_id: primaryId, evacuee_ids: [primaryId] });
		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe(DEPENDENCY_UNAVAILABLE);
	});

	it('maps unexpected write failures to a no-store 500', async () => {
		mockCheckIn.mockRejectedValueOnce(new Error('database unavailable'));
		const response = await send({ primary_evacuee_id: primaryId, evacuee_ids: [primaryId] });
		expect(response.status).toBe(500);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('KIOSK_CHECK_IN_FAILED');
	});

	it('stores the chip photo for a smart-card check-in after the members are written', async () => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			source: 'smart-card',
			citizen_id: citizenId,
			photo
		});
		expect(response.status).toBe(200);
		expect(mockCheckIn).toHaveBeenCalledWith('SH001', primaryId, [primaryId]);
		expect(mockSavePhoto).toHaveBeenCalledWith('SH001', 'test-kiosk-device', {
			primaryEvacueeId: primaryId,
			citizenId,
			photo,
			results: [{ evacuee_id: primaryId, status: 'checked_in', qr_payload: primaryId }]
		});
	});

	it('does not attempt a photo save when no photo is sent', async () => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			source: 'smart-card',
			citizen_id: citizenId
		});
		expect(response.status).toBe(200);
		expect(mockSavePhoto).not.toHaveBeenCalled();
	});

	it('keeps the check-in successful when the photo save fails', async () => {
		mockSavePhoto.mockResolvedValueOnce('failed');
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			source: 'smart-card',
			citizen_id: citizenId,
			photo
		});
		expect(response.status).toBe(200);
		expect((await response.json()).members[0].status).toBe('checked_in');
	});

	it.each([
		['bad base64', { ...photo, full_base64: 'not base64!' }],
		['unknown content type', { ...photo, content_type: 'image/png' }],
		['extra field', { ...photo, exif: 'x' }],
		['not an object', 'photo']
	])('drops an invalid photo (%s) and still checks in', async (_label, badPhoto) => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			source: 'smart-card',
			citizen_id: citizenId,
			photo: badPhoto
		});
		expect(response.status).toBe(200);
		expect((await response.json()).members[0].status).toBe('checked_in');
		expect(mockCheckIn).toHaveBeenCalledWith('SH001', primaryId, [primaryId]);
		expect(mockSavePhoto).not.toHaveBeenCalled();
	});

	it('drops an invalid photo on a QR check-in instead of rejecting it', async () => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			source: 'qr',
			photo: { content_type: 'image/png' }
		});
		expect(response.status).toBe(200);
		expect(mockSavePhoto).not.toHaveBeenCalled();
	});

	it.each([
		['qr', { source: 'qr' }],
		['phone', { source: 'phone' }],
		['missing source', {}],
		['smart-card without citizen_id', { source: 'smart-card' }]
	])('rejects a photo on a %s check-in with 400 before writing', async (_label, extra) => {
		const response = await send({
			primary_evacuee_id: primaryId,
			evacuee_ids: [primaryId],
			...extra,
			photo
		});
		expect(response.status).toBe(400);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('INVALID_CHECK_IN_INPUT');
		expect(mockCheckIn).not.toHaveBeenCalled();
		expect(mockSavePhoto).not.toHaveBeenCalled();
	});
});

describe('POST /api/v1/scanner/kiosk/check-in source thaid', () => {
	const sessionInvalid = {
		error: {
			code: 'KIOSK_THAID_SESSION_INVALID',
			message: 'การยืนยัน ThaiD หมดอายุหรือไม่ถูกต้อง กรุณาสแกนใหม่'
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return principal as never;
		});
		mockCheckIn.mockResolvedValue([
			{ evacuee_id: primaryId, status: 'checked_in', qr_payload: primaryId }
		] as never);
		mockHeartbeat.mockResolvedValue(undefined);
		mockThaidAllowed.mockResolvedValue(true);
		_resetSessionsForTest();
	});

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
		...extra
	});

	it('rejects when the ThaiD gate is off and leaves the session untouched', async () => {
		mockThaidAllowed.mockResolvedValueOnce(false);
		const sessionId = completedSession();

		const response = await send(body(sessionId));

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('KIOSK_METHOD_DISABLED');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockThaidAllowed).toHaveBeenCalledWith('SH001');
		expect(mockCheckIn).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('completed');
	});

	it('rejects a browser-supplied citizen id with 400 before touching the session', async () => {
		const sessionId = completedSession();

		const response = await send(body(sessionId, { citizen_id: citizenId }));

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('INVALID_CHECK_IN_INPUT');
		expect(mockCheckIn).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('completed');
	});

	it('answers 409 for a session that is not completed', async () => {
		const pending = createKioskCheckInSession({
			device_id: principal.registry_id,
			shelter_code: 'SH001'
		});

		const response = await send(body(pending.id));

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual(sessionInvalid);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockCheckIn).not.toHaveBeenCalled();
	});

	it('answers 409 for a cancelled or unknown session', async () => {
		const sessionId = completedSession();
		cancelKioskSession(sessionId, principal.registry_id);

		expect((await send(body(sessionId))).status).toBe(409);
		expect((await send(body('e'.repeat(32)))).status).toBe(409);
		expect(mockCheckIn).not.toHaveBeenCalled();
	});

	it('answers 409 for a session that belongs to another kiosk (AC-04)', async () => {
		const sessionId = completedSession('another-device-record');

		const response = await send(body(sessionId));

		expect(response.status).toBe(409);
		expect(mockCheckIn).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(sessionId, 'another-device-record')?.status).toBe('completed');
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
		expect(mockCheckIn).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(session.id, principal.registry_id)?.status).toBe('completed');
	});

	it('checks in with the session citizen required on the primary, then consumes the session', async () => {
		const sessionId = completedSession();

		const response = await send(body(sessionId));
		const text = await response.text();

		expect(response.status).toBe(200);
		expect(JSON.parse(text)).toEqual({
			shelter_code: 'SH001',
			members: [{ evacuee_id: primaryId, status: 'checked_in', qr_payload: primaryId }]
		});
		expect(text).not.toContain(citizenId);
		expect(mockCheckIn).toHaveBeenCalledWith('SH001', primaryId, [primaryId, memberId], {
			requiredPrimaryCitizenId: citizenId
		});
		expect(mockSavePhoto).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('consumed');
		expect(mockHeartbeat).toHaveBeenCalledWith('device-record-1');
	});

	it('answers 409 when the same session is replayed (AC-06)', async () => {
		const sessionId = completedSession();
		expect((await send(body(sessionId))).status).toBe(200);

		const replay = await send(body(sessionId));

		expect(replay.status).toBe(409);
		expect(await replay.json()).toEqual(sessionInvalid);
		expect(mockCheckIn).toHaveBeenCalledTimes(1);
	});

	it('lets only one of two concurrent submits through', async () => {
		const sessionId = completedSession();

		const statuses = (await Promise.all([send(body(sessionId)), send(body(sessionId))])).map(
			(response) => response.status
		);

		expect(statuses.sort()).toEqual([200, 409]);
		expect(mockCheckIn).toHaveBeenCalledTimes(1);
	});

	it('answers 409 when the primary is not the verified citizen', async () => {
		mockCheckIn.mockRejectedValueOnce(new KioskThaidIdentityMismatchError());
		const sessionId = completedSession();

		const response = await send(body(sessionId));
		const text = await response.text();

		expect(response.status).toBe(409);
		expect(JSON.parse(text)).toEqual(sessionInvalid);
		expect(text).not.toContain(citizenId);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockHeartbeat).not.toHaveBeenCalled();
	});

	it('releases the session when the write throws so the same scan can be retried', async () => {
		mockCheckIn.mockRejectedValueOnce(new Error('database unavailable'));
		const sessionId = completedSession();

		const failed = await send(body(sessionId));

		expect(failed.status).toBe(500);
		expect((await failed.json()).error.code).toBe('KIOSK_CHECK_IN_FAILED');
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('completed');

		const retry = await send(body(sessionId));

		expect(retry.status).toBe(200);
		expect(mockCheckIn).toHaveBeenCalledTimes(2);
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('consumed');
	});

	it('releases the session when every member write failed', async () => {
		mockCheckIn.mockResolvedValueOnce([
			{ evacuee_id: primaryId, status: 'failed' },
			{ evacuee_id: memberId, status: 'failed' }
		] as never);
		const sessionId = completedSession();

		const response = await send(body(sessionId));

		expect(response.status).toBe(200);
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('completed');
	});

	it('keeps the session consumed when at least one member was written', async () => {
		mockCheckIn.mockResolvedValueOnce([
			{ evacuee_id: primaryId, status: 'checked_in', qr_payload: primaryId },
			{ evacuee_id: memberId, status: 'failed' }
		] as never);
		const sessionId = completedSession();

		const response = await send(body(sessionId));

		expect(response.status).toBe(200);
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('consumed');
	});

	it('keeps the session consumed after an identity mismatch', async () => {
		mockCheckIn.mockRejectedValueOnce(new KioskThaidIdentityMismatchError());
		const sessionId = completedSession();

		expect((await send(body(sessionId))).status).toBe(409);
		expect(getKioskSessionForDevice(sessionId, principal.registry_id)?.status).toBe('consumed');
	});
});
