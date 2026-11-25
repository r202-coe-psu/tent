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

describe('GET /api/public/v1/volunteer/jobs — board filters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const get = (search: string, fetch: ReturnType<typeof upstream>) =>
		GET({
			url: new URL(`http://localhost/api/public/v1/volunteer/jobs${search}`),
			fetch,
			getClientAddress: () => '127.0.0.1'
		} as unknown as GetEvent);

	it('forwards q, status, page, page_size and every repeated skill', async () => {
		const fetch = upstream({ success: true, jobs: [], total: 0 });
		await get(
			'?q=%20ครัว%20&status=near_full&page=2&page_size=6&skill=cooking&skill=ทำอาหาร&shelter_code=SH001',
			fetch
		);

		const called = new URL(fetch.mock.calls[0][0] as string);
		expect(called.searchParams.get('q')).toBe('ครัว');
		expect(called.searchParams.get('status')).toBe('near_full');
		expect(called.searchParams.get('page')).toBe('2');
		expect(called.searchParams.get('page_size')).toBe('6');
		expect(called.searchParams.getAll('skill')).toEqual(['cooking', 'ทำอาหาร']);
		expect(called.searchParams.get('shelter_code')).toBe('SH001');
	});

	it('drops unknown params and malformed paging values', async () => {
		const fetch = upstream({ success: true, jobs: [], total: 0 });
		await get('?evil=1&status=bogus&page=abc&page_size=0&sort=title', fetch);

		expect(fetch).toHaveBeenCalledWith('http://localhost:9000/public/v1/jobs', expect.anything());
	});

	it('caps page_size at the backend limit', async () => {
		const fetch = upstream({ success: true, jobs: [], total: 0 });
		await get('?page_size=500', fetch);

		expect(fetch).toHaveBeenCalledWith(
			'http://localhost:9000/public/v1/jobs?page_size=50',
			expect.anything()
		);
	});

	it('refuses a page past the last allowed one, without asking FastAPI or CouchDB (B2)', async () => {
		const fetch = upstream({ success: true, jobs: [], total: 0 });
		const res = await get('?page=1000000000000000000000', fetch);

		expect(res.status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('hands a FastAPI 422 back to the caller instead of scanning CouchDB with admin rights (B2)', async () => {
		const fetch = upstream({ detail: [{ loc: ['query', 'page'] }] }, false, 422);
		const res = await get('?page=2', fetch);

		expect(res.status).toBe(422);
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('still falls back to CouchDB when FastAPI itself fails (5xx)', async () => {
		const fetch = upstream({ detail: 'boom' }, false, 503);
		adminRaw.mockResolvedValue({ status: 200, data: { rows: [] } });
		const res = await get('', fetch);

		expect(res.status).toBe(200);
		expect(adminRaw).toHaveBeenCalled();
	});

	it('filters and paginates the CouchDB fallback with the same params and reports total', async () => {
		const fetch = vi.fn().mockRejectedValue(new Error('fastapi down'));
		const job = (id: string, title: string, remaining: number) => ({
			_id: id,
			type: 'job',
			title,
			status: 'open',
			slots_remaining: remaining
		});
		adminRaw.mockImplementation(async (path: string) => {
			if (path.startsWith('/registry/')) {
				return {
					status: 200,
					data: {
						rows: [{ doc: { type: 'shelter', code: 'SH001', name: 'A', db: 'shelter_sh001' } }]
					}
				};
			}
			return {
				status: 200,
				data: {
					rows: [
						{ doc: job('job:1', 'ครัว 1', 5) },
						{ doc: job('job:2', 'ครัว 2', 0) },
						{ doc: job('job:3', 'ครัว 3', 2) },
						{ doc: job('job:4', 'ขับรถ', 5) }
					]
				}
			};
		});

		const body = await (await get('?q=ครัว&status=open&page=2&page_size=1', fetch)).json();

		expect(body.total).toBe(2);
		expect(body.jobs.map((j: { _id: string }) => j._id)).toEqual(['job:3']);
	});
});

describe('GET /api/public/v1/volunteer/jobs — CouchDB fallback statuses', () => {
	it('lists only what the worker puts on the board: open, full and the retired almost_full', async () => {
		vi.clearAllMocks();
		adminRaw.mockImplementation(async (path: string) => {
			if (path.startsWith('/registry/')) {
				return {
					status: 200,
					data: {
						rows: [{ doc: { type: 'shelter', code: 'SH001', name: 'A', db: 'shelter_sh001' } }]
					}
				};
			}
			const doc = (id: string, status: string) => ({
				doc: { _id: id, type: 'job', title: id, status }
			});
			return {
				status: 200,
				data: {
					rows: [
						doc('job:open', 'open'),
						doc('job:full', 'full'),
						doc('job:old', 'almost_full'),
						doc('job:paused', 'paused'),
						doc('job:draft', 'draft'),
						doc('job:closed', 'closed')
					]
				}
			};
		});

		const res = await GET({
			url: new URL('http://localhost/api/public/v1/volunteer/jobs'),
			fetch: vi.fn().mockRejectedValue(new Error('fastapi down')),
			getClientAddress: () => '127.0.0.1'
		} as unknown as GetEvent);
		const body = await res.json();

		expect(body.jobs.map((j: { _id: string }) => j._id).sort()).toEqual([
			'job:full',
			'job:old',
			'job:open'
		]);
	});
});

describe('GET /api/public/v1/volunteer/jobs — CouchDB fallback matches FastAPI (W3)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		adminRaw.mockImplementation(async (path: string) => {
			if (path === '/registry/_all_docs?include_docs=true') {
				return {
					status: 200,
					data: {
						rows: [
							{ doc: { type: 'shelter', code: 'SH001', name: 'A', db: 'shelter_sh001' } },
							{ doc: { type: 'shelter', code: 'SH002', name: 'วัดคอหงส์', db: 'shelter_sh002' } },
							{ doc: { type: 'shelter', code: 'SH003', name: 'ไม่มีงาน', db: 'shelter_sh003' } }
						]
					}
				};
			}
			if (path.startsWith('/registry/')) return { status: 404, data: {} };
			const db = path.split('/')[1];
			const rows =
				db === 'shelter_sh001'
					? [{ doc: { _id: 'job:a', type: 'job', title: 'ครัว', status: 'open' } }]
					: db === 'shelter_sh002'
						? [{ doc: { _id: 'job:b', type: 'job', title: 'ขับรถ', status: 'open' } }]
						: [];
			return { status: 200, data: { rows } };
		});
	});

	const getDown = (search: string) =>
		GET({
			url: new URL(`http://localhost/api/public/v1/volunteer/jobs${search}`),
			fetch: vi.fn().mockRejectedValue(new Error('fastapi down')),
			getClientAddress: () => '127.0.0.1'
		} as unknown as GetEvent);

	it('takes a lower-case shelter code, like FastAPI (N1)', async () => {
		const body = await (await getDown('?shelter_code=sh002')).json();
		expect(body.jobs.map((j: { _id: string }) => j._id)).toEqual(['job:b']);
	});

	it('lists only shelters with a job, even when filtered to one shelter (FR-6)', async () => {
		const body = await (await getDown('?shelter_code=SH002')).json();
		expect(body.shelters).toEqual([
			{ code: 'SH001', name: 'A' },
			{ code: 'SH002', name: 'วัดคอหงส์' }
		]);
	});

	it('matches q against the shelter name', async () => {
		const body = await (await getDown('?q=คอหงส์')).json();
		expect(body.jobs.map((j: { _id: string }) => j._id)).toEqual(['job:b']);
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
