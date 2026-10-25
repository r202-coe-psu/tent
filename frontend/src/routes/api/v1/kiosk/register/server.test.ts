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
	KioskPhoneDuplicateError,
	KioskRegistrationBlockedError,
	registerKioskThaidWalkIn,
	registerKioskWalkIn
} from '$lib/features/kiosk/server/kiosk-register.server';
import { mintConsentStamp, type ConsentDecision } from '$lib/features/consent/server';
import { isKioskThaidCheckInAllowed } from '$lib/features/kiosk/server/kiosk-thaid-gate.server';
import {
	_resetSessionsForTest,
	completeKioskSession,
	createKioskCheckInSession,
	getKioskSessionForDevice
} from '$lib/server/thaid-scan-session';

const { mockUpdateLastSeen } = vi.hoisted(() => ({
	mockUpdateLastSeen: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/features/kiosk-devices/server', () => ({
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
	return { ...actual, registerKioskWalkIn: vi.fn(), registerKioskThaidWalkIn: vi.fn() };
});
vi.mock('$lib/features/kiosk/server/kiosk-thaid-gate.server', () => ({
	isKioskThaidCheckInAllowed: vi.fn()
}));

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockFindShelter = vi.mocked(findMasterByCode);
const mockRegister = vi.mocked(registerKioskWalkIn);
const mockRegisterThaid = vi.mocked(registerKioskThaidWalkIn);
const mockThaidAllowed = vi.mocked(isKioskThaidCheckInAllowed);

function request(body: unknown, includeHeaders = true): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/kiosk/register', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(includeHeaders ? { 'x-device-id': 'KIOSK-01', 'x-device-secret': 'secret' } : {})
			},
			body: JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

function kioskDecision(overrides: object = {}): ConsentDecision {
	return {
		mode: 'full',
		health: false,
		search_visible: true,
		guardian_for: [],
		verbal: false,
		...mintConsentStamp(),
		...overrides
	} as ConsentDecision;
}

function consentFields(decision: ConsentDecision = kioskDecision()) {
	return { consent: decision, consented_at: decision.given_at };
}

const validBody = {
	card: { citizen_id: '1234567890123', first_name_th: 'สมชาย', gender: 'male' },
	...consentFields()
};

describe('POST /api/v1/kiosk/register', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
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
		mockRegister.mockResolvedValue({
			_id: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			phone: '0812345678',
			consent: { ref: validBody.consent.ref, mode: 'full' }
		} as never);
	});

	it('creates a record only under the authenticated shelter and disables caching', async () => {
		const response = await POST(request(validBody));
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			status: 'created',
			evacuee_id: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV',
			qr_payload: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV',
			label: { name: 'สมชาย ใจดี', phone: '0812345678' },
			consent_ref: validBody.consent.ref,
			consent_mode: 'full'
		});
		expect(mockRegister).toHaveBeenCalledWith(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			expect.objectContaining({ citizen_id: validBody.card.citizen_id }),
			null,
			validBody.consent,
			null,
			undefined
		);
		expect(mockUpdateLastSeen).toHaveBeenCalledWith('registry:KIOSK-01');
	});

	it('stores the phone typed at the kiosk in its canonical form', async () => {
		const response = await POST(request({ ...validBody, phone: '+66812345678' }));
		expect(response.status).toBe(200);
		expect(mockRegister).toHaveBeenCalledWith(
			'SH001',
			'KIOSK-01',
			'โต๊ะ 1',
			expect.anything(),
			null,
			validBody.consent,
			'0812345678',
			undefined
		);
	});

	it('passes the card-read time through as the Station 1 start (CR-192)', async () => {
		const startedAt = new Date(Date.now() - 45_000).toISOString();
		const response = await POST(request({ ...validBody, started_at: startedAt }));
		expect(response.status).toBe(200);
		expect(mockRegister.mock.calls[0]?.[7]).toBe(startedAt);
	});

	it('drops a malformed card-read time instead of failing the registration', async () => {
		const response = await POST(request({ ...validBody, started_at: { nope: true } }));
		expect(response.status).toBe(200);
		expect(mockRegister.mock.calls[0]?.[7]).toBeUndefined();
	});

	it('rejects a body that names the channel or device and registers nothing (CR-192 FR-STL-10)', async () => {
		const response = await POST(
			request({ ...validBody, channel: 'staff', device_id: 'forged-device', created_by: 'x' })
		);
		expect(response.status).toBe(400);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('rejects a phone that is not a Thai number', async () => {
		const response = await POST(request({ ...validBody, phone: '12345' }));
		expect(response.status).toBe(400);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('fails closed when walk-in registration is disabled', async () => {
		mockFindShelter.mockResolvedValue({
			feature_flags: { kiosk_walk_in_registration_enabled: false }
		} as never);
		const response = await POST(request(validBody));
		expect(response.status).toBe(403);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it.each([
		['no consent at all', { consent: undefined }],
		['a null consent', { consent: null }],
		['only the old consented flag', { consent: undefined, consented: true }],
		['guardian_for on the kiosk', { consent: kioskDecision({ guardian_for: ['member-1'] }) }],
		['verbal consent on the kiosk', { consent: kioskDecision({ verbal: true }) }],
		['a malformed consent ref', { consent: kioskDecision({ ref: 'CS-bad' }) }],
		[
			'a basic consent claiming health',
			{ consent: kioskDecision({ mode: 'basic', health: true }) }
		],
		['an unknown consent field', { consent: { ...kioskDecision(), channel: 'staff' } }],
		['a consented_at that is not the decision time', { consented_at: '2020-01-01T00:00:00.000Z' }]
	])('returns 400 and registers nobody for %s', async (_name, override) => {
		const response = await POST(request({ ...validBody, ...override }));
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('INVALID_KIOSK_REGISTRATION');
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

	it('returns 400 when the consent decision is older than ten minutes', async () => {
		const stale = kioskDecision(mintConsentStamp(new Date(Date.now() - 11 * 60 * 1000)));
		const response = await POST(request({ ...validBody, ...consentFields(stale) }));
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('KIOSK_CONSENT_EXPIRED');
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('keeps a decision dated ahead of the server a plain invalid body', async () => {
		const ahead = kioskDecision(mintConsentStamp(new Date(Date.now() + 11 * 60 * 1000)));
		const response = await POST(request({ ...validBody, ...consentFields(ahead) }));
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('INVALID_KIOSK_REGISTRATION');
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('returns conflict when the citizen has an existing record', async () => {
		mockRegister.mockRejectedValue(new KioskRegistrationBlockedError());
		const response = await POST(request(validBody));
		expect(response.status).toBe(409);
		expect((await response.json()).error.code).toBe('KIOSK_REGISTRATION_BLOCKED');
	});

	it('answers 409 KIOSK_PHONE_DUPLICATE when the phone is already in use', async () => {
		mockRegister.mockRejectedValue(new KioskPhoneDuplicateError());
		const response = await POST(request({ ...validBody, phone: '0812345678' }));
		expect(response.status).toBe(409);
		const { error } = await response.json();
		expect(error.code).toBe('KIOSK_PHONE_DUPLICATE');
		expect(error.message).toContain('เบอร์');
	});

	it('reports the shelter registry as unavailable separately from a write failure', async () => {
		mockFindShelter.mockRejectedValue(new ServiceError('INTERNAL', 'Could not read registry'));
		const response = await POST(request(validBody));
		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
		expect(mockRegister).not.toHaveBeenCalled();
	});
});

describe('POST /api/v1/kiosk/register source thaid', () => {
	const DEVICE = 'registry:KIOSK-01';
	const citizen = { pid: '1234567890123', sub: 'sub-1' };

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		_resetSessionsForTest();
		mockAuthenticate.mockResolvedValue({
			shelter_code: 'SH001',
			device_id: 'KIOSK-01',
			station_name: 'โต๊ะ 1',
			registry_id: DEVICE
		} as never);
		mockFindShelter.mockResolvedValue({
			feature_flags: { kiosk_walk_in_registration_enabled: true }
		} as never);
		mockThaidAllowed.mockResolvedValue(true);
		mockRegisterThaid.mockResolvedValue({
			_id: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			phone: null,
			consent: { ref: validBody.consent.ref, mode: 'full' }
		} as never);
	});

	function completedSession(shelterCode = 'SH001'): string {
		const session = createKioskCheckInSession({ device_id: DEVICE, shelter_code: shelterCode });
		completeKioskSession(session.id, citizen);
		return session.id;
	}

	function thaidBody(sessionId: string, extra: Record<string, unknown> = {}) {
		return {
			source: 'thaid',
			session_id: sessionId,
			phone: '0812345678',
			...consentFields(),
			...extra
		};
	}

	it('registers the session citizen, never a browser-supplied one, and uses the session up', async () => {
		const sessionId = completedSession();
		const body = thaidBody(sessionId);

		const response = await POST(request(body));

		expect(response.status).toBe(200);
		expect(mockRegisterThaid).toHaveBeenCalledWith(
			{ shelterCode: 'SH001', deviceId: 'KIOSK-01', stationName: 'โต๊ะ 1' },
			citizen,
			body.consent,
			'0812345678',
			undefined
		);
		expect(mockRegister).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(sessionId, DEVICE)?.status).toBe('consumed');
		expect((await POST(request(thaidBody(sessionId)))).status).toBe(409);
	});

	it('registers without a phone', async () => {
		const response = await POST(request(thaidBody(completedSession(), { phone: null })));
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			qr_payload: 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV',
			label: { name: 'สมชาย ใจดี', phone: null }
		});
		expect(mockRegisterThaid.mock.calls[0]?.[3]).toBeNull();
	});

	it('rejects a ThaiD registration without a valid consent, keeping the session', async () => {
		const sessionId = completedSession();
		const response = await POST(request(thaidBody(sessionId, { consent: undefined })));

		expect(response.status).toBe(400);
		expect(mockRegisterThaid).not.toHaveBeenCalled();
		expect(getKioskSessionForDevice(sessionId, DEVICE)?.status).toBe('completed');
	});

	it('rejects a citizen id or card sent with a ThaiD registration', async () => {
		const sessionId = completedSession();
		expect((await POST(request(thaidBody(sessionId, { citizen_id: '1' })))).status).toBe(400);
		expect((await POST(request(thaidBody(sessionId, { card: validBody.card })))).status).toBe(400);
		expect(mockRegisterThaid).not.toHaveBeenCalled();
	});

	it('answers 403 when ThaiD is switched off, keeping the session', async () => {
		mockThaidAllowed.mockResolvedValue(false);
		const sessionId = completedSession();

		const response = await POST(request(thaidBody(sessionId)));

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('KIOSK_METHOD_DISABLED');
		expect(getKioskSessionForDevice(sessionId, DEVICE)?.status).toBe('completed');
	});

	it('answers 409 for an unknown session or one minted for another shelter', async () => {
		const unknown = await POST(request(thaidBody('f'.repeat(32))));
		expect(unknown.status).toBe(409);
		expect((await unknown.json()).error.code).toBe('KIOSK_THAID_SESSION_INVALID');

		const otherShelter = completedSession('SH002');
		expect((await POST(request(thaidBody(otherShelter)))).status).toBe(409);
		expect(getKioskSessionForDevice(otherShelter, DEVICE)?.status).toBe('completed');
		expect(mockRegisterThaid).not.toHaveBeenCalled();
	});

	it('gives the session back when the write fails', async () => {
		mockRegisterThaid.mockRejectedValueOnce(new Error('couch down'));
		const sessionId = completedSession();

		const response = await POST(request(thaidBody(sessionId)));

		expect(response.status).toBe(503);
		expect(getKioskSessionForDevice(sessionId, DEVICE)?.status).toBe('completed');
	});

	it('keeps the session used when the citizen already has a record', async () => {
		mockRegisterThaid.mockRejectedValueOnce(new KioskRegistrationBlockedError());
		const sessionId = completedSession();

		const response = await POST(request(thaidBody(sessionId)));

		expect(response.status).toBe(409);
		expect((await response.json()).error.code).toBe('KIOSK_REGISTRATION_BLOCKED');
		expect(getKioskSessionForDevice(sessionId, DEVICE)?.status).toBe('consumed');
	});

	it('gives the session back when the phone is already in use, so a new phone needs no new scan', async () => {
		mockRegisterThaid.mockRejectedValueOnce(new KioskPhoneDuplicateError());
		const sessionId = completedSession();

		const response = await POST(request(thaidBody(sessionId)));

		expect(response.status).toBe(409);
		expect((await response.json()).error.code).toBe('KIOSK_PHONE_DUPLICATE');
		expect(getKioskSessionForDevice(sessionId, DEVICE)?.status).toBe('completed');
	});
});
