import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { POST } from './[id]/apply/+server';
import {
	volunteerApplyIpLimiter,
	volunteerApplyPhoneLimiter,
	volunteerTicketLimiter
} from '$lib/server/security/rate-limiter';
import {
	applyPublicVolunteerApplication,
	PublicApplicationError
} from '$lib/features/volunteers/server/public-application';

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

vi.mock('$lib/features/volunteers/server/public-application', () => ({
	applyPublicVolunteerApplication: vi.fn(),
	PublicApplicationError: class PublicApplicationError extends Error {
		code: string;
		httpStatus: number;
		constructor(code: string, httpStatus = 409) {
			super(code);
			this.code = code;
			this.httpStatus = httpStatus;
		}
	}
}));

const upstream = (body: unknown, ok = true, status = 200) =>
	vi.fn().mockResolvedValue({ ok, status, json: async () => body });

const validApplication = {
	shelter_code: 'SH001',
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

	it('writes through the direct CouchDB application service', async () => {
		vi.mocked(applyPublicVolunteerApplication).mockResolvedValue({
			tracking_token: 'TKT-VOL-1',
			status: 'confirmed',
			job_id: 'job:1'
		});
		const { response, fetch } = post(validApplication);
		const result = await response;

		expect(result.status).toBe(201);
		expect(await result.json()).toEqual({
			success: true,
			tracking_token: 'TKT-VOL-1',
			status: 'confirmed',
			job_id: 'job:1'
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(applyPublicVolunteerApplication).toHaveBeenCalledWith('job:1', {
			shelter_code: 'SH001',
			first_name: 'เก่งกล้า',
			last_name: 'งานอาสา',
			phone: '0812345678',
			skills: ['cooking']
		});
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

	it("passes the writer's own refusal through, so a full job says so", async () => {
		vi.mocked(applyPublicVolunteerApplication).mockRejectedValue(
			new PublicApplicationError('JOB_FULL', 409)
		);
		const { response } = post(validApplication);
		const result = await response;
		expect(result.status).toBe(409);
		expect(await result.json()).toEqual({ success: false, error: 'JOB_FULL' });
	});

	it('reports a writer server fault as a service failure, not as the applicant fault', async () => {
		vi.mocked(applyPublicVolunteerApplication).mockRejectedValue(new Error('boom'));
		const { response } = post(validApplication);
		const result = await response;
		expect(result.status).toBe(503);
		expect(await result.json()).toEqual({ success: false, error: 'APPLY_FAILED' });
	});
});
