import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCouchServer } from '$lib/server/test-support/fake-couch-multi-db';
import { createShelterCloseJobStore } from '$lib/server/shelter-close-job';
import { SHELTER_CLOSE_CHUNK_SIZE, previewShelterClose } from '$lib/server/shelter-close';

const h = vi.hoisted(() => ({
	env: { SHELTER_CLOSE_WORKER_TOKEN: 'close-secret' } as Record<string, string | undefined>,
	couch: null as unknown,
	store: null as unknown
}));
vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$lib/server/shelter-close-job-runtime', () => ({
	adminCouchReq: (method: string, path: string, body?: unknown) =>
		(h.couch as { req: (m: string, p: string, b?: unknown) => Promise<unknown> }).req(
			method,
			path,
			body
		),
	getShelterCloseStore: () => h.store
}));
const registry = vi.hoisted(() => ({
	master: { code: 'SH001', operation_status: 'active' } as Record<string, unknown> | null,
	updateMaster: vi.fn()
}));
vi.mock('$lib/server/shelters.admin', () => ({
	findMasterByCode: async () => registry.master,
	migrate: (m: unknown) => m,
	nowIso: () => '2026-11-10T00:00:00.000Z',
	updateMaster: registry.updateMaster
}));

import { POST } from './+server';

const SHELTER_DB = 'shelter_sh001';
let couch: FakeCouchServer;
let store: ReturnType<typeof createShelterCloseJobStore>;

function addEvacuee(i: number, status = 'active') {
	couch.put(SHELTER_DB, {
		_id: `evacuee:E${String(i).padStart(5, '0')}`,
		type: 'evacuee',
		schema_v: 5,
		shelter_code: 'SH001',
		household_id: null,
		current_stay: { status, zone: 'Z1', since: '2026-10-01T00:00:00.000Z' },
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'staff'
	});
}

function call(headers: Record<string, string> = { authorization: 'Bearer close-secret' }) {
	const request = new Request('http://localhost/api/internal/shelter-close/worker/next', {
		method: 'POST',
		headers
	});
	return POST({ request } as unknown as Parameters<typeof POST>[0]);
}

const auth = (extra: Record<string, string> = {}) => ({
	authorization: 'Bearer close-secret',
	...extra
});

async function createJob() {
	const preview = await previewShelterClose(couch.req, 'SH001');
	const res = await store.createJob({
		shelter_code: 'SH001',
		mode: 'close',
		requested_by: 'mgr1',
		preview
	});
	if (!res.created) throw new Error('not created');
}

const jobDoc = () =>
	couch.byType('central_ops', 'shelter_close_job')[0] as unknown as {
		lease_owner?: string;
		cursor: { after?: string };
		counters: { checked_out: number };
		status: string;
		closed: boolean;
	};

beforeEach(() => {
	couch = new FakeCouchServer();
	couch.createDb(SHELTER_DB);
	h.couch = couch;
	h.env.SHELTER_CLOSE_WORKER_TOKEN = 'close-secret';
	let n = 0;
	store = createShelterCloseJobStore({ couchReq: couch.req, ulid: () => `JOB${++n}` });
	h.store = store;
	registry.master = { code: 'SH001', operation_status: 'active' };
	registry.updateMaster.mockReset().mockResolvedValue({ id: 'shelter:1', rev: '2-x' });
});

describe('POST /api/internal/shelter-close/worker/next — auth (FR-11, AC-9)', () => {
	it.each([
		['no Authorization header', {}],
		['wrong token', { authorization: 'Bearer nope' }],
		['same length wrong token', { authorization: 'Bearer close-secreX' }],
		['wrong scheme', { authorization: 'Basic close-secret' }],
		['token without scheme', { authorization: 'close-secret' }]
	])('401 for %s, touching no data', async (_name, headers) => {
		addEvacuee(1);
		await createJob();
		couch.log.length = 0;
		const res = await call(headers);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			error: { code: 'UNAUTHORIZED', message: 'Invalid shelter close worker token' }
		});
		expect(couch.log).toHaveLength(0);
		expect(jobDoc().status).toBe('queued');
	});

	it('401 when the server has no token configured (never open)', async () => {
		h.env.SHELTER_CLOSE_WORKER_TOKEN = undefined;
		expect((await call({ authorization: 'Bearer ' })).status).toBe(401);
		expect((await call({})).status).toBe(401);
	});

	it('400 for a malformed worker id header', async () => {
		const res = await call(auth({ 'x-shelter-close-worker-id': 'bad id!' }));
		expect(res.status).toBe(400);
	});
});

describe('POST /api/internal/shelter-close/worker/next — work (FR-12..FR-14)', () => {
	it('204 with no content when there is no job', async () => {
		const res = await call(auth());
		expect(res.status).toBe(204);
		expect(await res.text()).toBe('');
	});

	it('claims the job for the worker id from the header and processes ONE chunk', async () => {
		const total = SHELTER_CLOSE_CHUNK_SIZE + 25;
		for (let i = 1; i <= total; i++) addEvacuee(i);
		await createJob();

		const res = await call(auth({ 'x-shelter-close-worker-id': 'worker-1' }));
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toContain('no-store');
		expect(await res.json()).toMatchObject({
			job_id: 'JOB1',
			shelter_code: 'SH001',
			status: 'running',
			phase: 'people',
			counters: { checked_out: SHELTER_CLOSE_CHUNK_SIZE },
			stopped: false,
			budget_exceeded: false
		});
		expect(jobDoc()).toMatchObject({ lease_owner: 'worker-1' });
		expect(jobDoc().cursor.after).toBeTruthy(); // cursor persisted for the next call
		expect(couch.byType(SHELTER_DB, 'movement')).toHaveLength(SHELTER_CLOSE_CHUNK_SIZE);
	});

	it('the next call continues from the cursor: no duplicate movements', async () => {
		const total = SHELTER_CLOSE_CHUNK_SIZE + 25;
		for (let i = 1; i <= total; i++) addEvacuee(i);
		await createJob();
		const headers = auth({ 'x-shelter-close-worker-id': 'worker-1' });
		await call(headers);
		const second = await (await call(headers)).json();
		expect(second.counters.checked_out).toBe(total);
		const movements = couch.byType(SHELTER_DB, 'movement');
		expect(movements).toHaveLength(total);
		expect(new Set(movements.map((m) => m.evacuee_id)).size).toBe(total);
	});

	it('mints a worker id when the header is absent', async () => {
		addEvacuee(1);
		await createJob();
		await call(auth());
		expect(jobDoc().lease_owner).toMatch(/^close-worker-/);
	});

	it('runs to completion and writes the registry exactly once, at finalize (FR-20)', async () => {
		addEvacuee(1);
		addEvacuee(2, 'pre_registered');
		await createJob();
		const headers = auth({ 'x-shelter-close-worker-id': 'w' });
		for (let i = 0; i < 20 && jobDoc().status !== 'completed'; i++) {
			expect(registry.updateMaster).not.toHaveBeenCalled();
			await call(headers);
		}
		expect(jobDoc()).toMatchObject({ status: 'completed', closed: true });
		expect(registry.updateMaster).toHaveBeenCalledTimes(1);
		const mutator = registry.updateMaster.mock.calls[0][1] as () => { patch: unknown };
		expect(mutator().patch).toEqual({
			operation_status: 'closed',
			updated_at: '2026-11-10T00:00:00.000Z'
		});
		expect((await call(headers)).status).toBe(204);
	});

	it('does not rewrite the registry of an already-closed shelter', async () => {
		registry.master = {
			code: 'SH001',
			operation_status: 'closed',
			closed_at: '2026-10-01T00:00:00.000Z'
		};
		addEvacuee(1);
		await createJob();
		for (let i = 0; i < 20 && jobDoc().status !== 'completed'; i++)
			await call(auth({ 'x-shelter-close-worker-id': 'w' }));
		expect(jobDoc().status).toBe('completed');
		expect(registry.updateMaster).not.toHaveBeenCalled();
	});

	it('500 with the error envelope and the lease given up when a chunk throws', async () => {
		addEvacuee(1);
		await createJob();
		couch.hook = ({ db, path }) =>
			db === SHELTER_DB && path.includes('_all_docs') ? { status: 500, data: {} } : undefined;
		const res = await call(auth({ 'x-shelter-close-worker-id': 'w' }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('INTERNAL');
		expect(jobDoc().lease_owner).toBeUndefined();
	});

	it('answers stopped:true when another worker owns the job mid-chunk (FR-13)', async () => {
		addEvacuee(1);
		await createJob();
		couch.hook = ({ db, method, path }) => {
			if (db === SHELTER_DB && method === 'POST' && path.includes('_bulk_docs')) {
				couch.put('central_ops', {
					...couch.byType('central_ops', 'shelter_close_job')[0],
					lease_owner: 'other'
				});
			}
			return undefined;
		};
		const res = await call(auth({ 'x-shelter-close-worker-id': 'w' }));
		expect(res.status).toBe(200);
		expect((await res.json()).stopped).toBe(true);
		expect(jobDoc().lease_owner).toBe('other');
	});
});
