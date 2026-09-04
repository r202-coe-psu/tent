import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import { volunteerApplyIpLimiter } from '$lib/server/security/rate-limiter';
import {
	applyPublicVolunteerApplication,
	PublicApplicationError
} from '$lib/features/volunteers/server/public-application';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$app/environment', () => ({ dev: true }));
vi.mock('$env/dynamic/private', () => ({ env: { SECRET_RECAPTCHA_KEY: '' } }));
vi.mock('$lib/features/public-register/server', () => ({
	isCaptchaKeyConfigured: () => false
}));
vi.mock('$lib/server/security/rate-limiter', () => ({
	volunteerApplyIpLimiter: { check: vi.fn(() => true) },
	volunteerApplyPhoneLimiter: { check: vi.fn(() => true) }
}));
vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {}
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

describe('POST /api/public/v1/volunteer/apply compatibility adapter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function makeEvent(body: Record<string, unknown>): PostEvent {
		return {
			request: new Request('http://localhost/api/public/v1/volunteer/apply', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			}),
			fetch: vi.fn(),
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent;
	}

	const input = {
		job_id: 'job:job-1',
		shelter_code: 'SH001',
		applicant: {
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			phone: '081-234-5678',
			email: null,
			skills: ['ครัว']
		},
		selected_shift: {
			shift_id: 'shift:morning',
			date: '2026-09-10',
			start_time: '08:00',
			end_time: '12:00'
		}
	};

	it('writes through the direct CouchDB application service', async () => {
		vi.mocked(applyPublicVolunteerApplication).mockResolvedValue({
			tracking_token: 'TKT-VOL-test',
			status: 'confirmed',
			job_id: 'job:job-1',
			shift_id: 'shift:morning'
		});

		const response = await POST(makeEvent(input));

		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({
			success: true,
			tracking_token: 'TKT-VOL-test'
		});
		expect(applyPublicVolunteerApplication).toHaveBeenCalledWith('job:job-1', {
			shelter_code: 'SH001',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			phone: '0812345678',
			email: '',
			skills: ['ครัว'],
			shift_id: 'shift:morning',
			shift_date: '2026-09-10',
			station: undefined
		});
	});

	it('preserves direct CouchDB business error codes', async () => {
		vi.mocked(applyPublicVolunteerApplication).mockRejectedValue(
			new PublicApplicationError('SHIFT_FULL', 409)
		);

		const response = await POST(makeEvent(input));

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ success: false, error: 'SHIFT_FULL' });
	});

	it('does not let missing local CAPTCHA keys lock a developer out', async () => {
		vi.mocked(volunteerApplyIpLimiter.check).mockReturnValue(false);
		vi.mocked(applyPublicVolunteerApplication).mockResolvedValue({
			tracking_token: 'TKT-VOL-test',
			status: 'confirmed',
			job_id: 'job:job-1'
		});

		const response = await POST(makeEvent(input));

		expect(response.status).toBe(201);
		expect(applyPublicVolunteerApplication).toHaveBeenCalledOnce();
	});
});
