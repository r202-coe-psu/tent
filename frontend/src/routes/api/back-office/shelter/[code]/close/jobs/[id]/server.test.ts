import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { FakeCouchServer } from '$lib/server/test-support/fake-couch-multi-db';
import { createShelterCloseJobStore } from '$lib/server/shelter-close-job';
import { shelterCloseJobViewSchema } from '$lib/features/shelters/server';

const h = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('$lib/server/shelter-close-job-runtime', () => ({
	adminCouchReq: vi.fn(),
	getShelterCloseStore: () => h.store
}));
vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return { ...actual, requireShelterManagerOrSA: vi.fn() };
});

import { GET } from './+server';
import { requireShelterManagerOrSA } from '$lib/server/couch-admin';

const guard = vi.mocked(requireShelterManagerOrSA);
const manager = { name: 'mgr1', roles: [], isSA: false, shelterCode: 'SHA01' };
const PREVIEW = { by_status: { active: 2 }, total: 2 };

let couch: FakeCouchServer;
let store: ReturnType<typeof createShelterCloseJobStore>;

function call(code: string, id: string) {
	const request = new Request(`http://localhost/api/back-office/shelter/${code}/close/jobs/${id}`, {
		headers: { cookie: 'AuthSession=abc' }
	});
	return GET({ request, params: { code, id } } as unknown as Parameters<typeof GET>[0]);
}

beforeEach(async () => {
	couch = new FakeCouchServer();
	let n = 0;
	store = createShelterCloseJobStore({ couchReq: couch.req, ulid: () => `JOB${++n}` });
	h.store = store;
	guard.mockReset().mockResolvedValue(manager);
	await store.createJob({
		shelter_code: 'SHA01',
		mode: 'close',
		requested_by: 'mgr1',
		preview: PREVIEW
	});
	await store.createJob({
		shelter_code: 'SHB01',
		mode: 'close',
		requested_by: 'mgrB',
		preview: PREVIEW
	});
});

describe('GET /api/back-office/shelter/[code]/close/jobs/[id] (CR-243 FR-8)', () => {
	it('returns the job view, no-store, matching the shared schema', async () => {
		const res = await call('SHA01', 'JOB1');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = await res.json();
		expect(shelterCloseJobViewSchema.safeParse(body).success).toBe(true);
		expect(body).toMatchObject({
			job_id: 'JOB1',
			shelter_code: 'SHA01',
			status: 'queued',
			phase: 'people',
			sweep_round: 0,
			counters: { checked_out: 0, cancelled: 0, households_repaired: 0, failed: 0 },
			failures: []
		});
		expect(guard).toHaveBeenCalledWith('AuthSession=abc', 'SHA01');
	});

	it('never leaks lease, cursor, _rev or the requester', async () => {
		await store.claimNext('worker-secret-id');
		const body = await (await call('SHA01', 'JOB1')).json();
		for (const key of [
			'lease_owner',
			'lease_until',
			'cursor',
			'_rev',
			'_id',
			'requested_by',
			'attempt'
		]) {
			expect(body).not.toHaveProperty(key);
		}
		expect(JSON.stringify(body)).not.toContain('worker-secret-id');
	});

	it('shows progress and failures of a running job', async () => {
		const claimed = (await store.claimNext('w1'))!;
		await store.saveProgress(
			claimed,
			{
				phase: 'households',
				sweep_round: 1,
				counters: { checked_out: 1, cancelled: 0, households_repaired: 0, failed: 1 },
				failures: [{ evacuee_id: 'evacuee:X', error: 'boom' }]
			},
			'w1'
		);
		expect(await (await call('SHA01', 'JOB1')).json()).toMatchObject({
			status: 'running',
			phase: 'households',
			sweep_round: 1,
			counters: { checked_out: 1, failed: 1 },
			failures: [{ evacuee_id: 'evacuee:X', error: 'boom' }]
		});
	});

	it('accepts the code case-insensitively', async () => {
		expect((await call('sha01', 'JOB1')).status).toBe(200);
	});

	it('404 — not 403 — when the job belongs to another shelter (AC-14)', async () => {
		const res = await call('SHA01', 'JOB2');
		expect(res.status).toBe(404);
		expect(JSON.stringify(await res.json())).not.toContain('SHB01');
	});

	it('answers 404 identically for a job that does not exist', async () => {
		const missing = await call('SHA01', 'NOPE');
		const other = await call('SHA01', 'JOB2');
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual(await other.json());
	});

	it('also resolves the full _id form and still scopes it to the shelter', async () => {
		expect((await call('SHA01', 'shelter_close_job:JOB1')).status).toBe(200);
		expect((await call('SHA01', 'shelter_close_job:JOB2')).status).toBe(404);
	});

	it('403 from the permission guard is passed through (checked before any job read)', async () => {
		guard.mockImplementationOnce(() => {
			throw error(403, 'not authorised');
		});
		couch.log.length = 0;
		expect((await call('SHA01', 'JOB1')).status).toBe(403);
		expect(couch.log).toHaveLength(0);
	});
});
