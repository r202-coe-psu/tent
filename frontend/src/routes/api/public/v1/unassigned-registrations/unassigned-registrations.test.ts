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

const VALID_BODY = {
	members: [
		{
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0812345678',
			nickname: 'ชาย',
			religion: 'buddhist',
			person_id: { cardType: 'national_id', number: '1234567890123' },
			country: 'THAILAND',
			vulnerable_groups: [],
			special_needs: [],
			emergency_contact: { name: 'สมหญิง', phone: '0899999999', relation: 'คู่สมรส' },
			photo: null,
			medical_conditions: [],
			medical_allergies: [],
			medical_medications: []
		}
	],
	household: {
		housing_type: 'owned_house',
		residence_landmark: null,
		address_no: '123/45',
		village_no: 'หมู่ 4',
		subdistrict: 'คอหงส์',
		district: 'หาดใหญ่',
		province: 'สงขลา',
		postal_code: '90110',
		pets: [],
		vehicles: [],
		assets: null
	},
	captchaToken: 'tok',
	disclaimerAcknowledged: true
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

	it('forwards UnifiedRegistrationInput via executor to FastAPI (no Couch write)', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({
				success: true,
				id: '01HTEST000000000000000000',
				schema_v: 2,
				reserved_household_id: 'household:01HTEST000000000000000001',
				members: [
					{
						reserved_evacuee_id: 'evacuee:01HTEST000000000000000002',
						status: 'open',
						first_name: 'สมชาย',
						last_name: 'ใจดี'
					}
				],
				registered_via: 'web',
				status: 'open',
				created_at: '2026-09-09T00:00:00Z'
			})
		});
		vi.stubGlobal('fetch', fetchMock);

		const res = await POST(event(VALID_BODY));
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.schema_v).toBe(2);
		expect(body.id).toBe('01HTEST000000000000000000');

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(String(url)).toContain('/public/v1/unassigned-registrations');
		const upstream = JSON.parse(init.body as string);
		expect(upstream.registered_via).toBe('web');
		expect(upstream.members[0].emergency_contact).toEqual({
			name: 'สมหญิง',
			phone: '0899999999',
			relation: 'คู่สมรส'
		});
		expect(upstream.members[0].nickname).toBe('ชาย');
	});

	it('requires disclaimer acknowledgment', async () => {
		const res = await POST(event({ ...VALID_BODY, disclaimerAcknowledged: false }));
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: 'DISCLAIMER_REQUIRED' });
	});

	it('rejects invalid input', async () => {
		const res = await POST(event({ ...VALID_BODY, members: [] }));
		expect(res.status).toBe(422);
	});
});
