import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { putAsPublicWriter } from '$lib/server/couch-public-writer';
import { registerIpLimiter, registerPhoneLimiter } from '$lib/server/security/rate-limiter';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: vi.fn()
}));

vi.mock('$lib/server/couch-public-writer', () => ({
	putAsPublicWriter: vi.fn()
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	registerIpLimiter: { check: vi.fn(() => true) },
	registerPhoneLimiter: { check: vi.fn(() => true) }
}));

const verifyToken = vi.fn<(token: string, ip?: string, action?: string) => Promise<boolean>>();
vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		verifyToken(token: string, ip?: string, action?: string) {
			return verifyToken(token, ip, action);
		}
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: { SECRET_RECAPTCHA_KEY: 'test-recaptcha-secret' }
}));

const OPEN_SHELTER = { code: 'SH001', name: 'ศูนย์ทดสอบ', operation_status: 'active' };

const VALID_BODY = {
	shelter_code: 'SH001',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	gender: 'male',
	phone: '0812345678',
	captchaToken: 'tok'
};

function event(body: unknown, ip = '203.0.113.5'): PostEvent {
	return {
		request: new Request('http://localhost/api/public/v1/registrations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => ip
	} as unknown as PostEvent;
}

describe('POST /api/public/v1/registrations', () => {
	beforeEach(() => {
		vi.mocked(findMasterByCode).mockReset();
		vi.mocked(putAsPublicWriter).mockReset();
		vi.mocked(registerIpLimiter.check).mockReturnValue(true);
		vi.mocked(registerPhoneLimiter.check).mockReturnValue(true);
		verifyToken.mockReset();
		verifyToken.mockResolvedValue(true);
	});

	it('422 when a required field is missing', async () => {
		const res = await POST(event({ ...VALID_BODY, first_name: '  ' }));
		expect(res.status).toBe(422);
		expect((await res.json()).error).toBe('INVALID_INPUT');
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('422 when the phone is not 10 digits — it is the lookup second factor', async () => {
		const res = await POST(event({ ...VALID_BODY, phone: '081234' }));
		expect(res.status).toBe(422);
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('429 when the IP is rate limited', async () => {
		vi.mocked(registerIpLimiter.check).mockReturnValue(false);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(429);
		expect((await res.json()).error).toBe('RATE_LIMITED');
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('429 when the phone is rate limited', async () => {
		vi.mocked(registerPhoneLimiter.check).mockReturnValue(false);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(429);
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('400 without a captcha token', async () => {
		const { captchaToken: _drop, ...noToken } = VALID_BODY;
		void _drop;
		const res = await POST(event(noToken));
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('CAPTCHA_REQUIRED');
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('403 when the captcha does not verify', async () => {
		verifyToken.mockResolvedValue(false);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(403);
		expect((await res.json()).error).toBe('CAPTCHA_FAILED');
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('404 for a shelter code that is not in the registry', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(null);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe('SHELTER_NOT_FOUND');
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('409 for a closed shelter (T-71: ศูนย์ closed จองไม่ได้)', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue({
			...OPEN_SHELTER,
			operation_status: 'closed'
		} as never);
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(409);
		expect((await res.json()).error).toBe('SHELTER_CLOSED');
		expect(putAsPublicWriter).not.toHaveBeenCalled();
	});

	it('still books a full shelter — FR-72 says warn, not block', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue({
			...OPEN_SHELTER,
			operation_status: 'full_capacity'
		} as never);
		vi.mocked(putAsPublicWriter).mockResolvedValue({ status: 201, data: { ok: true } });
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(201);
	});

	it('201 writes a pre_registered evacuee with registered_via web', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(OPEN_SHELTER as never);
		vi.mocked(putAsPublicWriter).mockResolvedValue({ status: 201, data: { ok: true } });

		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(201);

		const [dbName, docId, doc] = vi.mocked(putAsPublicWriter).mock.calls[0];
		expect(dbName).toBe('shelter_sh001');
		expect(docId).toMatch(/^evacuee:[0-9A-HJKMNP-TV-Z]{26}$/);

		const evacuee = doc as Record<string, unknown>;
		expect(evacuee.type).toBe('evacuee');
		expect(evacuee.schema_v).toBe(7);
		expect(evacuee.shelter_code).toBe('SH001');
		expect(evacuee.created_by).toBe('public');
		expect(evacuee.registered_via).toBe('web');
		expect(evacuee.current_stay).toMatchObject({ status: 'pre_registered', zone: null });
		// Create-only: a _rev would turn an accidental id collision into an overwrite.
		expect(evacuee).not.toHaveProperty('_rev');

		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.code).toBe((docId as string).replace('evacuee:', ''));
		expect(body.status).toBe('pre_registered');
	});

	it('ignores client-supplied _id, _rev, current_stay and registered_via', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(OPEN_SHELTER as never);
		vi.mocked(putAsPublicWriter).mockResolvedValue({ status: 201, data: { ok: true } });

		await POST(
			event({
				...VALID_BODY,
				_id: 'evacuee:ATTACKERCHOSENID0000000000',
				_rev: '9-deadbeef',
				current_stay: { status: 'active', zone: 'A', since: '2020-01-01T00:00:00.000Z' },
				registered_via: 'app',
				shelter_code: 'SH001'
			})
		);

		const [, docId, doc] = vi.mocked(putAsPublicWriter).mock.calls[0];
		const evacuee = doc as Record<string, unknown>;
		expect(docId).not.toBe('evacuee:ATTACKERCHOSENID0000000000');
		expect(evacuee).not.toHaveProperty('_rev');
		expect(evacuee.registered_via).toBe('web');
		expect(evacuee.current_stay).toMatchObject({ status: 'pre_registered' });
	});

	it('502 when CouchDB rejects the write', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(OPEN_SHELTER as never);
		vi.mocked(putAsPublicWriter).mockResolvedValue({
			status: 403,
			data: { error: 'forbidden', reason: 'shelter_code must be SH001' }
		});
		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(502);
		expect((await res.json()).error).toBe('WRITE_FAILED');
	});

	it('never returns PII on the ticket (Public task DoD)', async () => {
		vi.mocked(findMasterByCode).mockResolvedValue(OPEN_SHELTER as never);
		vi.mocked(putAsPublicWriter).mockResolvedValue({ status: 201, data: { ok: true } });

		const body = await (await POST(event(VALID_BODY))).json();
		const serialized = JSON.stringify(body);
		expect(Object.keys(body).sort()).toEqual([
			'booked_at',
			'code',
			'first_name',
			'shelter_code',
			'shelter_name',
			'status',
			'success'
		]);
		expect(serialized).not.toContain('0812345678');
		expect(serialized).not.toContain('person_id');
		expect(serialized).not.toContain('ใจดี'); // last name stays off the public ticket
	});
});
