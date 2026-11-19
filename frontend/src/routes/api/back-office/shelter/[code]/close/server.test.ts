import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { FakeCouchServer } from '$lib/server/test-support/fake-couch-multi-db';
import { createShelterCloseJobStore } from '$lib/server/shelter-close-job';

// Real job store + real preview over an in-memory CouchDB (CR-243 test seam): only auth and the
// registry lookup are mocked. The POST must create a job and answer 202 without touching people.
const h = vi.hoisted(() => ({ couch: null as unknown, store: null as unknown }));
vi.mock('$lib/server/shelter-close-job-runtime', () => ({
	adminCouchReq: (method: string, path: string, body?: unknown) =>
		(h.couch as { req: (m: string, p: string, b?: unknown) => Promise<unknown> }).req(
			method,
			path,
			body
		),
	getShelterCloseStore: () => h.store
}));
vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return { ...actual, adminRaw: vi.fn(), requireShelterManagerOrSA: vi.fn() };
});
vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: vi.fn(),
	migrate: (m: unknown) => m,
	nowIso: () => '2026-11-01T08:00:00.000Z',
	updateMaster: vi.fn()
}));

import { GET, POST } from './+server';
import { requireShelterManagerOrSA } from '$lib/server/couch-admin';
import { findMasterByCode, updateMaster } from '$lib/server/shelters.admin';
import type { ShelterMaster } from '$lib/features/shelters/server';

const guard = vi.mocked(requireShelterManagerOrSA);
const findMaster = vi.mocked(findMasterByCode);
const update = vi.mocked(updateMaster);

const manager = {
	name: 'mgr1',
	roles: ['shelter:SH001', 'shelter_manager'],
	isSA: false,
	shelterCode: 'SH001'
};
const master = {
	_id: 'shelter:01',
	code: 'SH001',
	name: 'ศูนย์  วัดกลาง',
	operation_status: 'active'
};
const CONFIRM = 'SH001 ศูนย์ วัดกลาง';
const SHELTER_DB = 'shelter_sh001';

let couch: FakeCouchServer;

function addEvacuee(id: string, status: string) {
	couch.put(SHELTER_DB, {
		_id: id,
		type: 'evacuee',
		schema_v: 5,
		shelter_code: 'SH001',
		household_id: null,
		current_stay: { status, zone: 'Z1', since: '2026-10-01T00:00:00.000Z' }
	});
}

function call(
	handler: typeof GET | typeof POST,
	method: string,
	body?: unknown,
	code = 'SH001'
): Promise<Response> {
	const request = new Request(`http://localhost/api/back-office/shelter/${code}/close`, {
		method,
		headers: { cookie: 'AuthSession=abc', 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return Promise.resolve(
		handler({ request, params: { code } } as unknown as Parameters<typeof GET>[0])
	);
}

const jobs = () => couch.byType('central_ops', 'shelter_close_job');

beforeEach(() => {
	couch = new FakeCouchServer();
	couch.createDb(SHELTER_DB);
	h.couch = couch;
	let n = 0;
	h.store = createShelterCloseJobStore({ couchReq: couch.req, ulid: () => `JOB${++n}` });
	addEvacuee('evacuee:1', 'active');
	addEvacuee('evacuee:2', 'active');
	addEvacuee('evacuee:3', 'active');
	addEvacuee('evacuee:4', 'pre_registered');
	addEvacuee('evacuee:5', 'checked_out');
	guard.mockReset().mockResolvedValue(manager);
	findMaster.mockReset().mockResolvedValue(master as unknown as ShelterMaster);
	update.mockReset();
});

describe('GET /api/back-office/shelter/[code]/close (CR-219 FR-7, CR-243 FR-5)', () => {
	it('returns counts by status for SA / the shelter manager, no active_job', async () => {
		const res = await call(GET, 'GET');
		expect(guard).toHaveBeenCalledWith('AuthSession=abc', 'SH001');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual({ by_status: { active: 3, pre_registered: 1 }, total: 4 });
	});

	it('adds active_job { job_id, status } while a job is queued / running (FR-5)', async () => {
		await call(POST, 'POST', { confirm_text: CONFIRM });
		const body = await (await call(GET, 'GET')).json();
		expect(body).toEqual({
			by_status: { active: 3, pre_registered: 1 },
			total: 4,
			active_job: { job_id: 'JOB1', status: 'queued' }
		});
	});

	it('drops active_job once the job is terminal (FR-3a lock cleanup)', async () => {
		await call(POST, 'POST', { confirm_text: CONFIRM });
		const job = jobs()[0];
		couch.put('central_ops', { ...job, status: 'completed', phase: 'done' });
		expect(await (await call(GET, 'GET')).json()).not.toHaveProperty('active_job');
	});

	it('403 for a manager of another shelter or another role (FR-22)', async () => {
		guard.mockImplementationOnce(() => {
			throw error(403, 'not authorised');
		});
		const res = await call(GET, 'GET', undefined, 'SH999');
		expect(res.status).toBe(403);
	});

	it('404 for an unknown shelter', async () => {
		findMaster.mockResolvedValueOnce(null);
		expect((await call(GET, 'GET')).status).toBe(404);
	});
});

describe('POST /api/back-office/shelter/[code]/close (CR-243 FR-6, FR-7, FR-10)', () => {
	it('202 { job_id } and a queued job — nobody is processed in the request (AC-1)', async () => {
		const res = await call(POST, 'POST', { confirm_text: CONFIRM });
		expect(res.status).toBe(202);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual({ job_id: 'JOB1' });

		expect(jobs()).toHaveLength(1);
		expect(jobs()[0]).toMatchObject({
			status: 'queued',
			mode: 'close',
			shelter_code: 'SH001',
			phase: 'people',
			preview: { by_status: { active: 3, pre_registered: 1 }, total: 4 }
		});
		// no evacuee, movement or registry write happened
		expect(couch.byType(SHELTER_DB, 'movement')).toHaveLength(0);
		expect(
			couch
				.byType(SHELTER_DB, 'evacuee')
				.map((e) => (e.current_stay as { status: string }).status)
				.sort()
		).toEqual(['active', 'active', 'active', 'checked_out', 'pre_registered']);
		expect(couch.bulkLog).toHaveLength(0);
		expect(update).not.toHaveBeenCalled();
	});

	it('takes requested_by from the session, never the body (FR-10)', async () => {
		await call(POST, 'POST', { confirm_text: CONFIRM, requested_by: 'attacker', mode: 'backfill' });
		expect(jobs()[0]).toMatchObject({ requested_by: 'mgr1', mode: 'close' });
	});

	it('409 { job_id } of the existing job and no second job (FR-7, AC-3)', async () => {
		await call(POST, 'POST', { confirm_text: CONFIRM });
		const res = await call(POST, 'POST', { confirm_text: CONFIRM });
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ job_id: 'JOB1' });
		expect(jobs()).toHaveLength(1);
	});

	it('202 again when the lock points at a finished job (AC-13)', async () => {
		await call(POST, 'POST', { confirm_text: CONFIRM });
		couch.put('central_ops', { ...jobs()[0], status: 'completed_with_errors', phase: 'done' });
		const res = await call(POST, 'POST', { confirm_text: CONFIRM });
		expect(res.status).toBe(202);
		expect((await res.json()).job_id).toBe('JOB2');
	});

	it('accepts extra whitespace in the confirm text but stays case-sensitive (CR-219 FR-17)', async () => {
		expect((await call(POST, 'POST', { confirm_text: '  SH001   ศูนย์ วัดกลาง ' })).status).toBe(
			202
		);
		couch.remove('central_ops', 'shelter_close_lock:SH001');
		const lower = await call(POST, 'POST', { confirm_text: 'sh001 ศูนย์ วัดกลาง' });
		expect(lower.status).toBe(400);
		expect(await lower.json()).toEqual({
			error: { code: 'VALIDATION', message: 'ข้อความยืนยันไม่ตรงกับรหัสและชื่อศูนย์' }
		});
	});

	it.each([{ confirm_text: 'SH001' }, { confirm_text: 'SH001 ศูนย์อื่น' }, {}, null])(
		'400 and no job when confirm_text is %j',
		async (body) => {
			const res = await call(POST, 'POST', body);
			expect(res.status).toBe(400);
			expect(jobs()).toHaveLength(0);
		}
	);

	it('409 for an external shelter (CR-252) and no job', async () => {
		findMaster.mockResolvedValueOnce({ ...master, is_external: true } as unknown as ShelterMaster);
		expect((await call(POST, 'POST', { confirm_text: CONFIRM })).status).toBe(409);
		expect(jobs()).toHaveLength(0);
	});

	it('404 for an unknown shelter', async () => {
		findMaster.mockResolvedValueOnce(null);
		expect((await call(POST, 'POST', { confirm_text: CONFIRM })).status).toBe(404);
		expect(jobs()).toHaveLength(0);
	});

	it('403 for a manager of another shelter (FR-22) and no job', async () => {
		guard.mockImplementationOnce(() => {
			throw error(403, 'not authorised');
		});
		const res = await call(POST, 'POST', { confirm_text: 'SH999 x' }, 'SH999');
		expect(res.status).toBe(403);
		expect(jobs()).toHaveLength(0);
	});

	it('keeps job and lock out of the shelter db (FR-4)', async () => {
		await call(POST, 'POST', { confirm_text: CONFIRM });
		expect(
			couch.docs(SHELTER_DB).filter((d) => String(d._id).startsWith('shelter_close_'))
		).toHaveLength(0);
	});
});
