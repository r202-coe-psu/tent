import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/features/kiosk-devices/server', () => ({
	scannerServerRepository: { getDeviceByDeviceId: vi.fn(), updateDeviceLastSeen: vi.fn() }
}));
vi.mock('$lib/server/scanners/staff-pin-store', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/staff-pin-store')>(
		'$lib/server/scanners/staff-pin-store'
	);
	return { ...actual, staffPinSecretStore: { get: vi.fn() } };
});
vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, adminFetch: vi.fn() };
});
vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));

import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import { adminFetch } from '$lib/server/couch-admin';
import { hashScannerSecret } from '$lib/server/scanners/device-credentials';
import {
	staffPinSecretStore,
	StaffPinUnavailableError,
	type StaffPinSecret
} from '$lib/server/scanners/staff-pin-store';
import {
	STAFF_PIN_WRONG_DELAY_MS,
	staffPinThrottle
} from '$lib/server/scanners/staff-pin-throttle';
import { findMasterByCode } from '$lib/server/shelters.admin';

const SECRET = 'sk_scan_test_secret';
const PIN = '482913';
const primaryId = 'evacuee:01ARZ3NDEKTSV4RRFFQ69G5FAV';

function deviceDoc() {
	return {
		_id: 'scanner_device:kiosk-01',
		_rev: '1-a',
		type: 'scanner_device',
		schema_v: 2,
		created_at: '2026-10-08T00:00:00Z',
		updated_at: '2026-10-08T00:00:00Z',
		created_by: 'sa',
		device_id: 'kiosk-01',
		name: 'Kiosk 1',
		shelter_code: 'SH001',
		station_name: 'ประตู 1',
		secret_hash: hashScannerSecret(SECRET),
		secret_prefix: 'sk_scan_aaaaaaaa...',
		status: 'active',
		last_seen_at: null,
		staff_pin_set: true,
		staff_pin_is_default: true,
		staff_pin_updated_at: '2026-10-08T00:00:00Z',
		staff_pin_updated_by: 'sa'
	};
}

const secretDoc: StaffPinSecret = {
	_id: 'staff_pin:kiosk-01',
	_rev: '1-s',
	type: 'scanner_staff_pin',
	schema_v: 1,
	device_id: 'kiosk-01',
	pin: PIN,
	is_default: true,
	updated_at: '2026-10-08T00:00:00Z',
	updated_by: 'sa'
};

const primary = {
	_id: primaryId,
	type: 'evacuee',
	shelter_code: 'SH001',
	registered_via: 'kiosk',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	person_id: { number: '1234567890123' },
	household_id: 'household:A',
	current_stay: { status: 'arriving' }
};

const pinBody = {
	phone: '0812345678',
	primary_evacuee_id: primaryId,
	staff_pin: PIN,
	evacuee_ids: [primaryId]
};

function request(body: unknown, headers: Record<string, string> = {}): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/kiosk/reprint', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-device-id': 'kiosk-01',
				'x-device-secret': SECRET,
				...headers
			},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

describe('POST /api/v1/kiosk/reprint with a staff PIN', () => {
	const mockLookup = vi.mocked(scannerServerRepository.getDeviceByDeviceId);
	const mockSecret = vi.mocked(staffPinSecretStore.get);
	let info: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		info = vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockLookup.mockResolvedValue(deviceDoc() as never);
		vi.mocked(scannerServerRepository.updateDeviceLastSeen).mockResolvedValue(undefined);
		mockSecret.mockResolvedValue(secretDoc);
		vi.mocked(findMasterByCode).mockResolvedValue({
			code: 'SH001',
			feature_flags: { kiosk_phone_check_in_enabled: true }
		} as never);
		vi.mocked(adminFetch).mockImplementation(async (path) => {
			if (path.endsWith('/_find')) return { docs: [] } as never;
			if (decodeURIComponent(path).endsWith(primaryId)) return primary as never;
			throw Object.assign(new Error('not found'), { status: 404 });
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('prints with the right staff PIN and logs the bypass without the PIN', async () => {
		const response = await POST(request(pinBody));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.shelter_code).toBe('SH001');
		expect(body.members.map((m: { evacuee_id: string }) => m.evacuee_id)).toEqual([primaryId]);
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain(
			`[kiosk-reprint] staff_pin_bypass device=kiosk-01 shelter=SH001 primary=${primaryId} labels=1`
		);
		expect(logged).not.toContain(PIN);
		expect(logged).not.toContain('0812345678');
	});

	it('refuses a wrong staff PIN with 401 only after the ~1 s hold, and prints nothing', async () => {
		let answered = false;
		const pending = Promise.resolve(POST(request({ ...pinBody, staff_pin: '111112' }))).finally(
			() => (answered = true)
		);
		await vi.advanceTimersByTimeAsync(STAFF_PIN_WRONG_DELAY_MS - 1);
		expect(answered).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		const response = await pending;

		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body).toEqual({
			error: { code: 'KIOSK_REPRINT_STAFF_PIN_INVALID', message: 'PIN ไม่ถูกต้อง' }
		});
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(info.mock.calls.flat().join(' ')).not.toContain('staff_pin_bypass');
	});

	it('answers 409 staff_pin_not_set when the kiosk has no staff PIN', async () => {
		mockSecret.mockResolvedValue(null);

		const response = await POST(request(pinBody));

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: 'staff_pin_not_set',
				message: 'ยังข้ามขั้นตอนนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ'
			}
		});
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('answers 503 DEPENDENCY_UNAVAILABLE when the PIN store cannot be read', async () => {
		mockSecret.mockRejectedValue(new StaffPinUnavailableError());

		const response = await POST(request(pinBody));

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน' }
		});
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(info.mock.calls.flat().join(' ')).toContain('result=unavailable');
	});

	it('answers 429 RATE_LIMITED at once when the kiosk PIN queue is full', async () => {
		const wrong = { ...pinBody, staff_pin: '111112' };
		const first = POST(request(wrong));
		await vi.advanceTimersByTimeAsync(0);
		const second = POST(request(wrong));
		await vi.advanceTimersByTimeAsync(0);

		const third = await POST(request(wrong));

		expect(third.status).toBe(429);
		expect(await third.json()).toEqual({
			error: { code: 'RATE_LIMITED', message: 'กำลังตรวจ PIN อยู่ กรุณารอสักครู่' }
		});
		expect(third.headers.get('cache-control')).toBe('no-store');
		expect(info.mock.calls.flat().join(' ')).toContain('result=busy');
		await vi.advanceTimersByTimeAsync(STAFF_PIN_WRONG_DELAY_MS * 2);
		expect((await first).status).toBe(401);
		expect((await second).status).toBe(401);
	});

	it('answers 503, not 500, when the cluster never grants the PIN check a turn', async () => {
		vi.spyOn(staffPinThrottle, 'run').mockRejectedValueOnce(
			new Error('Staff PIN turn not granted in time')
		);

		const response = await POST(request(pinBody));

		expect(response.status).toBe(503);
		expect((await response.json()).error).toEqual({
			code: 'DEPENDENCY_UNAVAILABLE',
			message: 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน'
		});
		expect(info.mock.calls.flat().join(' ')).toContain('result=error');
	});

	it.each([
		['both id_last4 and staff_pin', { ...pinBody, id_last4: '0123' }],
		['neither id_last4 nor staff_pin', { ...pinBody, staff_pin: undefined }]
	])('answers 400 INVALID_REPRINT_INPUT for a body with %s', async (_label, body) => {
		const response = await POST(request(body));

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('INVALID_REPRINT_INPUT');
		expect(mockSecret).not.toHaveBeenCalled();
	});

	it("checks the authenticated device's own PIN", async () => {
		const response = await POST(request(pinBody));

		expect(response.status).toBe(200);
		expect(mockSecret).toHaveBeenCalledTimes(1);
		expect(mockSecret).toHaveBeenCalledWith('kiosk-01');
	});

	it('refuses a body that names another device, without reading any PIN', async () => {
		const response = await POST(request({ ...pinBody, device_id: 'kiosk-99' }));

		expect(response.status).toBe(400);
		expect(mockSecret).not.toHaveBeenCalled();
	});
});
