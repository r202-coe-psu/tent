import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { POST } from './[id]/apply/+server';
import {
	volunteerApplyIpLimiter,
	volunteerApplyPhoneLimiter,
	volunteerTicketLimiter
} from '$lib/server/security/rate-limiter';

type GetEvent = Parameters<typeof GET>[0];
type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/security/rate-limiter', () => ({
	volunteerTicketLimiter: { check: vi.fn(() => true) },
	volunteerApplyIpLimiter: { check: vi.fn(() => true) },
	volunteerApplyPhoneLimiter: { check: vi.fn(() => true) }
}));

vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		verifyToken() {
			return Promise.resolve(true);
		}
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		SECRET_RECAPTCHA_KEY: 'test-recaptcha-secret',
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	}
}));

const upstream = (body: unknown, ok = true, status = 200) =>
	vi.fn().mockResolvedValue({ ok, status, json: async () => body });

const validApplication = {
	first_name: 'เก่งกล้า',
	last_name: 'งานอาสา',
	phone: '081-234-5678',
	skills: ['cooking'],
	captchaToken: 'dummy-token'
};

describe('GET /api/public/v1/volunteer/jobs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(volunteerTicketLimiter.check).mockReturnValue(true);
	});

	it('forwards the board request with the service credential and never caches it', async () => {
		const fetch = upstream({ success: true, jobs: [{ job_id: 'job:1' }] });
		const response = await GET({
			url: new URL('http://localhost/api/public/v1/volunteer/jobs'),
			fetch,
			getClientAddress: () => '127.0.0.1'
		} as unknown as GetEvent);

		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toEqual({ success: true, jobs: [{ job_id: 'job:1' }] });
		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:9000/public/v1/jobs',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer test-external-secret' })
			})
		);
	});

	it('passes only the filters FastAPI accepts, and drops the rest', async () => {
		const fetch = upstream({ success: true, jobs: [] });
		await GET({
			url: new URL(
				'http://localhost/api/public/v1/volunteer/jobs?shelter_code=SH001&skill=cooking&status=draft'
			),
			fetch,
			getClientAddress: () => '127.0.0.1'
		} as unknown as GetEvent);

		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:9000/public/v1/jobs?shelter_code=SH001&skill=cooking',
			expect.anything()
		);
	});

	it('refuses once the read budget is spent', async () => {
		vi.mocked(volunteerTicketLimiter.check).mockReturnValue(false);
		const fetch = upstream({ success: true, jobs: [] });
		const response = await GET({
			url: new URL('http://localhost/api/public/v1/volunteer/jobs'),
			fetch,
			getClientAddress: () => '127.0.0.1'
		} as unknown as GetEvent);

		expect(response.status).toBe(429);
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('POST /api/public/v1/volunteer/jobs/[id]/apply', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(volunteerApplyIpLimiter.check).mockReturnValue(true);
		vi.mocked(volunteerApplyPhoneLimiter.check).mockReturnValue(true);
	});

	function post(body: unknown, fetch = upstream({ success: true, tracking_token: 'TKT-VOL-1' })) {
		return {
			response: POST({
				params: { id: 'job:1' },
				request: { json: () => Promise.resolve(body) },
				fetch,
				getClientAddress: () => '127.0.0.1'
			} as unknown as PostEvent),
			fetch
		};
	}

	it('normalises the application and never forwards the captcha token', async () => {
		const { response, fetch } = post(validApplication);
		const result = await response;

		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ success: true, tracking_token: 'TKT-VOL-1' });

		const [url, init] = vi.mocked(fetch).mock.calls[0]!;
		expect(url).toBe('http://localhost:9000/public/v1/jobs/job%3A1/apply');
		const sent = JSON.parse(String((init as RequestInit).body));
		// The separators the applicant typed are stripped before the phone is used as a key
		// anywhere downstream — the same normalisation the ticket lookup applies.
		expect(sent.phone).toBe('0812345678');
		expect(sent).not.toHaveProperty('captchaToken');
	});

	it('rejects a malformed application before spending any budget', async () => {
		const { response, fetch } = post({ ...validApplication, phone: '123' });
		expect((await response).status).toBe(422);
		expect(fetch).not.toHaveBeenCalled();
		expect(volunteerApplyIpLimiter.check).not.toHaveBeenCalled();
	});

	it('refuses when either the IP or the phone budget is spent', async () => {
		vi.mocked(volunteerApplyPhoneLimiter.check).mockReturnValue(false);
		const { response, fetch } = post(validApplication);
		expect((await response).status).toBe(429);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("passes upstream's own refusal through, so a full job says so", async () => {
		const { response } = post(
			validApplication,
			upstream({ detail: { success: false, error: 'JOB_FULL' } }, false, 409)
		);
		const result = await response;
		expect(result.status).toBe(409);
		expect(await result.json()).toEqual({ success: false, error: 'JOB_FULL' });
	});

	it('reports an upstream server fault as a gateway failure, not as the applicant fault', async () => {
		const { response } = post(validApplication, upstream({ detail: 'boom' }, false, 500));
		const result = await response;
		expect(result.status).toBe(502);
		expect(await result.json()).toEqual({ success: false, error: 'APPLY_FAILED' });
	});
});
