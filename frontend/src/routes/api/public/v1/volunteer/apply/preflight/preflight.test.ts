import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import {
	preflightPublicVolunteerApplication,
	PublicApplicationError
} from '$lib/features/volunteers/server/public-application';

type PostEvent = Parameters<typeof POST>[0];

const { mockEnv, mockAppEnv } = vi.hoisted(() => ({
	mockEnv: { SECRET_RECAPTCHA_KEY: '' },
	mockAppEnv: { dev: false }
}));

vi.mock('$app/environment', () => ({
	get dev() {
		return mockAppEnv.dev;
	},
	browser: false
}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/features/public-register/server', () => ({
	isCaptchaKeyConfigured: (key: string | undefined) => Boolean(key)
}));
vi.mock('$lib/features/volunteers/server/public-application', () => ({
	preflightPublicVolunteerApplication: vi.fn(),
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

function makeEvent(body: unknown): PostEvent {
	return {
		request: new Request('http://localhost/api/public/v1/volunteer/apply/preflight', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		getClientAddress: () => '127.0.0.1'
	} as unknown as PostEvent;
}

const input = {
	job_id: 'job:job-1',
	shelter_code: 'SH001',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	phone: '081-234-5678',
	email: '',
	skills: ['ครัว'],
	shift_id: 'shift:morning',
	shift_date: '2026-09-10',
	start_time: '08:00',
	end_time: '12:00'
};

describe('POST /api/public/v1/volunteer/apply/preflight', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnv.SECRET_RECAPTCHA_KEY = '';
		mockAppEnv.dev = false;
	});

	it('passes the shift date the modal sends through to the service', async () => {
		vi.mocked(preflightPublicVolunteerApplication).mockResolvedValue({
			match: 'no_match',
			message: 'ไม่พบ Volunteer profile เดิม สามารถสมัครใหม่ได้'
		});

		const response = await POST(makeEvent(input));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ success: true, match: 'no_match' });
		expect(preflightPublicVolunteerApplication).toHaveBeenCalledWith('job:job-1', {
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
	});

	it('rejects a shift date that is not YYYY-MM-DD', async () => {
		const response = await POST(makeEvent({ ...input, shift_date: '10/09/2026' }));

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ success: false, error: 'VALIDATION_ERROR' });
		expect(preflightPublicVolunteerApplication).not.toHaveBeenCalled();
	});

	it('rejects a body that is not JSON', async () => {
		const response = await POST(makeEvent('{not json'));

		expect(response.status).toBe(400);
		expect(preflightPublicVolunteerApplication).not.toHaveBeenCalled();
	});

	it('returns the business error code with its status, for the client to word', async () => {
		vi.mocked(preflightPublicVolunteerApplication).mockRejectedValue(
			new PublicApplicationError('WRITER_UNAVAILABLE', 503)
		);

		const response = await POST(makeEvent(input));

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ success: false, error: 'WRITER_UNAVAILABLE' });
	});

	it('logs an unexpected failure and answers PREFLIGHT_FAILED', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.mocked(preflightPublicVolunteerApplication).mockRejectedValue(new Error('socket hang up'));

		const response = await POST(makeEvent(input));

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ success: false, error: 'PREFLIGHT_FAILED' });
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});
});
