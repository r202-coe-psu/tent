import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { POST } from './[id]/apply/+server';
import {
	applyPublicVolunteerApplicationToShifts,
	PublicApplicationError
} from '$lib/features/volunteers/server/public-application';

type GetEvent = Parameters<typeof GET>[0];
type PostEvent = Parameters<typeof POST>[0];

const { adminRaw, verifyToken, providerProjectId } = vi.hoisted(() => ({
	adminRaw: vi.fn(),
	verifyToken: vi.fn<(token: string, ip?: string, action?: string) => Promise<boolean>>(),
	providerProjectId: { value: '' }
}));

vi.mock('$app/environment', () => ({
	dev: false,
	browser: false
}));

vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		constructor(projectId: string) {
			providerProjectId.value = projectId;
		}

		verifyToken(token: string, ip?: string, action?: string) {
			return verifyToken(token, ip, action);
		}
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		RECAPTCHA_PROJECT_ID: 'smart-shelter-508719',
		SECRET_RECAPTCHA_KEY: '',
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	}
}));

vi.mock('$lib/server/couch-admin', () => ({ adminRaw }));

vi.mock('$lib/features/volunteers/server/public-application', () => ({
	applyPublicVolunteerApplicationToShifts: vi.fn(),
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
		verifyToken.mockResolvedValue(true);
		adminRaw.mockResolvedValue({
			status: 200,
			data: { _id: 'config:app', type: 'config', recaptcha_enabled: true }
		});
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
		expect(await response.json()).toEqual({
			success: true,
			jobs: [{ job_id: 'job:1', applicants_count: 0 }]
		});
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
});

describe('POST /api/public/v1/volunteer/jobs/[id]/apply', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

	const saved = (shiftId: string | null, token: string) => ({
		ok: true as const,
		shift_id: shiftId,
		status: 'confirmed',
		tracking_token: token
	});

	it('writes through the direct CouchDB application service', async () => {
		vi.mocked(applyPublicVolunteerApplicationToShifts).mockResolvedValue({
			job_id: 'job:1',
			results: [saved(null, 'TKT-VOL-1')]
		});
		const { response, fetch } = post(validApplication);
		const result = await response;

		expect(result.status).toBe(201);
		expect(await result.json()).toEqual({
			success: true,
			tracking_token: 'TKT-VOL-1',
			status: 'confirmed',
			job_id: 'job:1',
			shift_id: null,
			results: [saved(null, 'TKT-VOL-1')]
		});
		expect(fetch).not.toHaveBeenCalled();
		// A single-shift request is a batch of one, built from its own shift fields.
		expect(applyPublicVolunteerApplicationToShifts).toHaveBeenCalledWith(
			'job:1',
			{
				shelter_code: 'SH001',
				first_name: 'เก่งกล้า',
				last_name: 'งานอาสา',
				phone: '0812345678',
				skills: ['cooking']
			},
			[{ shift_id: undefined, shift_date: undefined }]
		);
		expect(providerProjectId.value).toBe('smart-shelter-508719');
		expect(verifyToken).toHaveBeenCalledWith('dummy-token', '127.0.0.1', 'volunteer_apply');
	});

	it('requires a CAPTCHA token when the shared gate is enabled', async () => {
		const { response, fetch } = post({ ...validApplication, captchaToken: undefined });

		expect((await response).status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
		expect(applyPublicVolunteerApplicationToShifts).not.toHaveBeenCalled();
	});

	it('blocks the application when CAPTCHA verification fails', async () => {
		verifyToken.mockResolvedValue(false);
		const { response, fetch } = post(validApplication);

		expect((await response).status).toBe(403);
		expect(fetch).not.toHaveBeenCalled();
		expect(applyPublicVolunteerApplicationToShifts).not.toHaveBeenCalled();
	});

	it('skips CAPTCHA when the operator disables the shared gate', async () => {
		adminRaw.mockResolvedValue({
			status: 200,
			data: { _id: 'config:app', type: 'config', recaptcha_enabled: false }
		});
		vi.mocked(applyPublicVolunteerApplicationToShifts).mockResolvedValue({
			job_id: 'job:1',
			results: [saved(null, 'TKT-VOL-1')]
		});

		const { response } = post({ ...validApplication, captchaToken: undefined });

		expect((await response).status).toBe(201);
		expect(verifyToken).not.toHaveBeenCalled();
	});

	it('rejects a malformed application', async () => {
		const { response, fetch } = post({ ...validApplication, phone: '123' });
		expect((await response).status).toBe(422);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("passes the writer's own refusal through, so a full job says so", async () => {
		vi.mocked(applyPublicVolunteerApplicationToShifts).mockRejectedValue(
			new PublicApplicationError('JOB_FULL', 409)
		);
		const { response } = post(validApplication);
		const result = await response;
		expect(result.status).toBe(409);
		expect(await result.json()).toEqual({ success: false, error: 'JOB_FULL' });
	});

	it('sends every picked shift as one batch (#716)', async () => {
		const shifts = [
			{ shift_id: 's-am', shift_date: '2026-09-10', start_time: '08:00', end_time: '12:00' },
			{ shift_id: 's-pm', shift_date: '2026-09-10', start_time: '13:00', end_time: '17:00' }
		];
		vi.mocked(applyPublicVolunteerApplicationToShifts).mockResolvedValue({
			job_id: 'job:1',
			volunteer_token: 'VOL-TOKEN',
			results: [
				saved('s-am', 'TKT-AM'),
				{ ok: false, shift_id: 's-pm', error: 'SHIFT_FULL', http_status: 409 }
			]
		});

		const result = await post({ ...validApplication, shifts }).response;

		expect(result.status).toBe(201);
		expect(await result.json()).toMatchObject({
			success: true,
			tracking_token: 'TKT-AM',
			shift_id: 's-am',
			volunteer_token: 'VOL-TOKEN',
			results: [
				{ ok: true, shift_id: 's-am' },
				{ ok: false, shift_id: 's-pm', error: 'SHIFT_FULL' }
			]
		});
		expect(vi.mocked(applyPublicVolunteerApplicationToShifts).mock.calls[0][2]).toEqual(shifts);
	});

	it('answers with the first shift error when no shift was saved', async () => {
		vi.mocked(applyPublicVolunteerApplicationToShifts).mockResolvedValue({
			job_id: 'job:1',
			results: [
				{ ok: false, shift_id: 's-am', error: 'TIME_CONFLICT', http_status: 409 },
				{ ok: false, shift_id: 's-pm', error: 'SHIFT_NOT_FOUND', http_status: 422 }
			]
		});

		const result = await post({
			...validApplication,
			shifts: [{ shift_id: 's-am' }, { shift_id: 's-pm' }]
		}).response;

		expect(result.status).toBe(409);
		expect(await result.json()).toMatchObject({
			success: false,
			error: 'TIME_CONFLICT',
			results: [{ error: 'TIME_CONFLICT' }, { error: 'SHIFT_NOT_FOUND' }]
		});
	});

	it('rejects more shifts than one request may carry', async () => {
		const shifts = Array.from({ length: 32 }, (_, i) => ({ shift_id: `s${i}` }));
		const result = await post({ ...validApplication, shifts }).response;
		expect(result.status).toBe(422);
		expect(applyPublicVolunteerApplicationToShifts).not.toHaveBeenCalled();
	});

	it('reports a writer server fault as a service failure, not as the applicant fault', async () => {
		vi.mocked(applyPublicVolunteerApplicationToShifts).mockRejectedValue(new Error('boom'));
		const { response } = post(validApplication);
		const result = await response;
		expect(result.status).toBe(503);
		expect(await result.json()).toEqual({ success: false, error: 'APPLY_FAILED' });
	});
});
