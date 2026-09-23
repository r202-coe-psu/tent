import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import {
	volunteerApplyIpLimiter,
	volunteerApplyPhoneLimiter
} from '$lib/server/security/rate-limiter';
import {
	applyPublicVolunteerApplication,
	PublicApplicationError
} from '$lib/features/volunteers/server/public-application';

type PostEvent = Parameters<typeof POST>[0];

const { mockEnv, mockAppEnv, adminRaw, verifyToken } = vi.hoisted(() => ({
	mockEnv: {
		RECAPTCHA_PROJECT_ID: 'smart-shelter-508719',
		SECRET_RECAPTCHA_KEY: ''
	},
	mockAppEnv: { dev: false },
	adminRaw: vi.fn(),
	verifyToken: vi.fn<(token: string, ip?: string, action?: string) => Promise<boolean>>()
}));

vi.mock('$app/environment', () => ({
	get dev() {
		return mockAppEnv.dev;
	},
	browser: false
}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/couch-admin', () => ({ adminRaw }));
vi.mock('$lib/server/security/rate-limiter', () => ({
	volunteerApplyIpLimiter: { check: vi.fn(() => true) },
	volunteerApplyPhoneLimiter: { check: vi.fn(() => true) }
}));
vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		verifyToken(token: string, ip?: string, action?: string) {
			return verifyToken(token, ip, action);
		}
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

describe('POST /api/public/v1/volunteer/apply compatibility adapter', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(applyPublicVolunteerApplication).mockReset();
		vi.mocked(volunteerApplyIpLimiter.check).mockReturnValue(true);
		vi.mocked(volunteerApplyPhoneLimiter.check).mockReturnValue(true);
		mockEnv.RECAPTCHA_PROJECT_ID = 'smart-shelter-508719';
		mockEnv.SECRET_RECAPTCHA_KEY = '';
		mockAppEnv.dev = false;
		verifyToken.mockResolvedValue(true);
		adminRaw.mockResolvedValue({
			status: 200,
			data: { _id: 'config:app', type: 'config', recaptcha_enabled: true }
		});
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
		},
		recaptcha_token: 'captcha-token'
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
			start_time: '08:00',
			end_time: '12:00',
			station: undefined
		});
		expect(verifyToken).toHaveBeenCalledWith('captcha-token', '127.0.0.1', 'volunteer_apply');
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
		mockAppEnv.dev = true;
		mockEnv.RECAPTCHA_PROJECT_ID = '';
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

	it('returns CAPTCHA_REQUIRED when production CAPTCHA is enabled without a token', async () => {
		const response = await POST(makeEvent({ ...input, recaptcha_token: undefined }));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ success: false, error: 'CAPTCHA_REQUIRED' });
		expect(applyPublicVolunteerApplication).not.toHaveBeenCalled();
	});

	it('skips CAPTCHA when the operator disables it', async () => {
		adminRaw.mockResolvedValue({
			status: 200,
			data: { _id: 'config:app', type: 'config', recaptcha_enabled: false }
		});
		vi.mocked(applyPublicVolunteerApplication).mockResolvedValue({
			tracking_token: 'TKT-VOL-disabled',
			status: 'confirmed',
			job_id: 'job:job-1'
		});

		const response = await POST(makeEvent({ ...input, recaptcha_token: undefined }));

		expect(response.status).toBe(201);
		expect(verifyToken).not.toHaveBeenCalled();
	});

	it('fails closed in production when Enterprise CAPTCHA is unconfigured', async () => {
		mockEnv.RECAPTCHA_PROJECT_ID = '';

		const response = await POST(makeEvent({ ...input, recaptcha_token: undefined }));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			success: false,
			error: 'SERVER_MISCONFIGURED'
		});
		expect(adminRaw).not.toHaveBeenCalled();
		expect(applyPublicVolunteerApplication).not.toHaveBeenCalled();
	});
});
