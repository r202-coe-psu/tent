import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { registerIpLimiter, registerPhoneLimiter } from '$lib/server/security/rate-limiter';

type PostEvent = Parameters<typeof POST>[0];

const { mockEnv, mockAppEnv } = vi.hoisted(() => ({
	mockEnv: {
		SECRET_RECAPTCHA_KEY: 'test-recaptcha-secret',
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	},
	mockAppEnv: { dev: false }
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({
	get dev() {
		return mockAppEnv.dev;
	}
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

const ADDRESS = {
	address_no: '123/45',
	village_no: 'หมู่ 4',
	subdistrict: 'คอหงส์',
	district: 'หาดใหญ่',
	province: 'สงขลา',
	postal_code: '90110'
};

const VALID_BODY = {
	phone: '0812345678',
	members: [
		{
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			person_id: { cardType: 'national_id', number: '1234567890123' },
			special_needs: [],
			vulnerable_groups: []
		}
	],
	household: {
		housing_type: 'owned_house',
		address: ADDRESS,
		pets: []
	},
	captchaToken: 'tok'
};

function event(body: unknown, ip = '203.0.113.5'): PostEvent {
	return {
		request: new Request('http://localhost/api/public/v1/unassigned-registrations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => ip,
		fetch: globalThis.fetch
	} as unknown as PostEvent;
}

describe('POST /api/public/v1/unassigned-registrations', () => {
	beforeEach(() => {
		vi.mocked(registerIpLimiter.check).mockReset();
		vi.mocked(registerPhoneLimiter.check).mockReset();
		vi.mocked(registerIpLimiter.check).mockReturnValue(true);
		vi.mocked(registerPhoneLimiter.check).mockReturnValue(true);
		verifyToken.mockReset();
		verifyToken.mockResolvedValue(true);
		vi.unstubAllGlobals();
	});

	it('forwards to FastAPI with Bearer secret and no Couch write', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({
				success: true,
				id: '01HTEST000000000000000000',
				schema_v: 1,
				reserved_household_id: 'household:01HTEST000000000000000001',
				members: [
					{
						reserved_evacuee_id: 'evacuee:01HTEST000000000000000002',
						status: 'open',
						first_name: 'สมชาย',
						last_name: 'ใจดี',
						gender: 'male',
						phone: '0812345678',
						person_id: { cardType: 'national_id', number: '1234567890123' },
						country: 'THAILAND',
						vulnerable_groups: [],
						special_needs: []
					}
				],
				registered_via: 'web',
				status: 'open',
				created_at: '2026-09-07T00:00:00+00:00'
			})
		});
		vi.stubGlobal('fetch', fetchMock);

		const response = await POST(event(VALID_BODY));
		expect(response.status).toBe(201);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.reserved_household_id).toMatch(/^household:/);
		expect(body.members[0].status).toBe('open');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('http://localhost:9000/public/v1/unassigned-registrations');
		expect(init.method).toBe('POST');
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer test-external-secret');
		const sent = JSON.parse(String(init.body));
		expect(sent.registered_via).toBe('web');
		expect(sent.members[0].phone).toBe('0812345678');
		expect(sent).not.toHaveProperty('shelter_code');
		expect(sent).not.toHaveProperty('captchaToken');
	});

	it('maps FastAPI duplicate identity to 409', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				status: 409,
				json: async () => ({ errors: [{ error: 'DUPLICATE_OPEN_IDENTITY' }] })
			})
		);

		const response = await POST(event(VALID_BODY));
		expect(response.status).toBe(409);
		const body = await response.json();
		expect(body.success).toBe(false);
		expect(body.error).toBe('DUPLICATE_OPEN_IDENTITY');
	});

	it('rejects invalid input without calling FastAPI', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const response = await POST(event({ ...VALID_BODY, members: [] }));
		expect(response.status).toBe(422);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
