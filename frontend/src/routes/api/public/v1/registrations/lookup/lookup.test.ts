import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { findMasterByCode, listShelterMasters } from '$lib/server/shelters.admin';
import { registerLookupIpLimiter } from '$lib/server/security/rate-limiter';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));

vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: vi.fn(),
	listShelterMasters: vi.fn()
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	registerLookupIpLimiter: { check: vi.fn(() => true) }
}));

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const DOC_ID = `evacuee:${ULID}`;

const BOOKING = {
	_id: DOC_ID,
	type: 'evacuee',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '0812345678',
	shelter_code: 'SH001',
	created_at: '2026-08-20T03:00:00.000Z',
	registered_via: 'web',
	current_stay: { status: 'pre_registered', zone: null, since: '2026-08-20T03:00:00.000Z' },
	person_id: { cardType: 'national_id', number: '1234567890123' }
};

function event(body: unknown): PostEvent {
	return {
		request: new Request('http://localhost/api/public/v1/registrations/lookup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => '203.0.113.9'
	} as unknown as PostEvent;
}

describe('POST /api/public/v1/registrations/lookup', () => {
	beforeEach(() => {
		vi.mocked(adminRaw).mockReset();
		vi.mocked(listShelterMasters).mockReset();
		vi.mocked(findMasterByCode).mockReset();
		vi.mocked(registerLookupIpLimiter.check).mockReturnValue(true);
		vi.mocked(listShelterMasters).mockResolvedValue([{ code: 'SH001' }] as never);
		vi.mocked(findMasterByCode).mockResolvedValue({
			code: 'SH001',
			name: 'ศูนย์ทดสอบ'
		} as never);
	});

	it('422 when a field is missing', async () => {
		const res = await POST(event({ code: ULID }));
		expect(res.status).toBe(422);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('429 when rate limited', async () => {
		vi.mocked(registerLookupIpLimiter.check).mockReturnValue(false);
		const res = await POST(event({ code: ULID, phone: '0812345678' }));
		expect(res.status).toBe(429);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('returns the redacted ticket on a code + phone match', async () => {
		vi.mocked(adminRaw).mockResolvedValue({ status: 200, data: BOOKING });

		const res = await POST(event({ code: ULID, phone: '0812345678' }));
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body).toMatchObject({
			success: true,
			code: ULID,
			shelter_code: 'SH001',
			shelter_name: 'ศูนย์ทดสอบ',
			first_name: 'สมชาย',
			status: 'pre_registered'
		});

		// Public task DoD — no PII, no medical, no national ID, no full phone.
		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain('1234567890123');
		expect(serialized).not.toContain('0812345678');
		expect(serialized).not.toContain('ใจดี');
	});

	it('accepts a full doc id and lowercase input as the code', async () => {
		vi.mocked(adminRaw).mockResolvedValue({ status: 200, data: BOOKING });
		const res = await POST(event({ code: `evacuee:${ULID.toLowerCase()}`, phone: '0812345678' }));
		expect(res.status).toBe(200);
	});

	it('gives the same generic 404 for a wrong phone as for an unknown code', async () => {
		vi.mocked(adminRaw).mockResolvedValue({ status: 200, data: BOOKING });
		const wrongPhone = await POST(event({ code: ULID, phone: '0899999999' }));

		vi.mocked(adminRaw).mockResolvedValue({ status: 404, data: { error: 'not_found' } });
		const unknownCode = await POST(
			event({ code: '01ZZZZZZZZZZZZZZZZZZZZZZZZ', phone: '0812345678' })
		);

		expect(wrongPhone.status).toBe(404);
		expect(unknownCode.status).toBe(404);
		expect(await wrongPhone.json()).toEqual(await unknownCode.json());
	});

	it('refuses to expose a staff-registered person', async () => {
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: { ...BOOKING, registered_via: 'app' }
		});
		const res = await POST(event({ code: ULID, phone: '0812345678' }));
		expect(res.status).toBe(404);
	});

	it('refuses a booking whose doc carries no phone', async () => {
		vi.mocked(adminRaw).mockResolvedValue({ status: 200, data: { ...BOOKING, phone: null } });
		const res = await POST(event({ code: ULID, phone: '0812345678' }));
		expect(res.status).toBe(404);
	});

	it('searches every shelter until the doc is found', async () => {
		vi.mocked(listShelterMasters).mockResolvedValue([
			{ code: 'SH001' },
			{ code: 'SH002' }
		] as never);
		vi.mocked(adminRaw)
			.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } })
			.mockResolvedValueOnce({ status: 200, data: { ...BOOKING, shelter_code: 'SH002' } });

		const res = await POST(event({ code: ULID, phone: '0812345678' }));
		expect(res.status).toBe(200);
		expect((await res.json()).shelter_code).toBe('SH002');
		expect(vi.mocked(adminRaw).mock.calls[0][0]).toContain('shelter_sh001');
		expect(vi.mocked(adminRaw).mock.calls[1][0]).toContain('shelter_sh002');
	});
});
