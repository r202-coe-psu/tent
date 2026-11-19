import { beforeEach, describe, expect, it } from 'vitest';
import { FakeCouchServer } from './test-support/fake-couch-multi-db';
import {
	SHELTER_CLOSE_DEFAULTS,
	buildShelterCloseDesignDoc,
	createShelterCloseJobStore,
	readShelterCloseConfig,
	shelterCloseJobUlid,
	shelterCloseLockId,
	toShelterCloseJobView,
	type ShelterCloseJob,
	type ShelterCloseJobStore
} from './shelter-close-job';

const T0 = Date.parse('2026-11-10T00:00:00.000Z');
const PREVIEW = { by_status: { active: 2 }, total: 2 };
const CENTRAL = 'central_ops';

let couch: FakeCouchServer;
let now: number;
let n: number;
let store: ShelterCloseJobStore;

const make = (config = {}) =>
	createShelterCloseJobStore({
		couchReq: couch.req,
		now: () => now,
		ulid: () => `JOB${String(++n).padStart(3, '0')}`,
		config: { leaseMs: 1000, staleMs: 10_000, maxAttempts: 3, ...config }
	});

beforeEach(() => {
	couch = new FakeCouchServer();
	now = T0;
	n = 0;
	store = make();
});

async function create(code = 'SH001', requested_by = 'mgr1') {
	const res = await store.createJob({
		shelter_code: code,
		mode: 'close',
		requested_by,
		preview: PREVIEW
	});
	if (!res.created) throw new Error('expected a new job');
	return res.job;
}

const job = (id: string) =>
	couch.get(CENTRAL, `shelter_close_job:${id}`) as unknown as ShelterCloseJob;
const lock = (code: string) => couch.get(CENTRAL, shelterCloseLockId(code));

describe('readShelterCloseConfig (CR-243 §4)', () => {
	it('falls back to the documented defaults', () => {
		expect(readShelterCloseConfig({})).toEqual(SHELTER_CLOSE_DEFAULTS);
		expect(SHELTER_CLOSE_DEFAULTS).toEqual({
			chunkBudgetMs: 20_000,
			timeoutMs: 30_000,
			leaseMs: 60_000,
			staleMs: 600_000,
			maxAttempts: 5,
			maxFailures: 50
		});
	});

	it('reads every override and ignores blank / non-positive / non-numeric values', () => {
		expect(
			readShelterCloseConfig({
				SHELTER_CLOSE_CHUNK_BUDGET_MS: '1',
				SHELTER_CLOSE_WORKER_TIMEOUT_MS: '2',
				SHELTER_CLOSE_LEASE_MS: '3',
				SHELTER_CLOSE_STALE_MS: '4',
				SHELTER_CLOSE_MAX_ATTEMPTS: '6',
				SHELTER_CLOSE_MAX_FAILURES: '7'
			})
		).toEqual({
			chunkBudgetMs: 1,
			timeoutMs: 2,
			leaseMs: 3,
			staleMs: 4,
			maxAttempts: 6,
			maxFailures: 7
		});
		expect(
			readShelterCloseConfig({
				SHELTER_CLOSE_LEASE_MS: ' ',
				SHELTER_CLOSE_STALE_MS: '-5',
				SHELTER_CLOSE_MAX_ATTEMPTS: 'abc',
				SHELTER_CLOSE_MAX_FAILURES: '0'
			})
		).toEqual(SHELTER_CLOSE_DEFAULTS);
	});
});

describe('design doc + ids (FR-1)', () => {
	it('emits [status, lease_until ?? created_at] for queued / running jobs only', () => {
		const ddoc = buildShelterCloseDesignDoc();
		expect(ddoc._id).toBe('_design/shelter_close');
		const map = ddoc.views.jobs_claimable.map;
		const run = (doc: Record<string, unknown>) => {
			const out: unknown[] = [];
			new Function('emit', `return (${map})`)((k: unknown) => out.push(k))(doc);
			return out;
		};
		expect(run({ type: 'shelter_close_job', status: 'queued', created_at: 'c' })).toEqual([
			['queued', 'c']
		]);
		expect(
			run({ type: 'shelter_close_job', status: 'running', created_at: 'c', lease_until: 'l' })
		).toEqual([['running', 'l']]);
		expect(run({ type: 'shelter_close_job', status: 'completed', created_at: 'c' })).toEqual([]);
		expect(run({ type: 'other', status: 'queued', created_at: 'c' })).toEqual([]);
	});

	it('strips the job prefix and upper-cases lock ids', () => {
		expect(shelterCloseJobUlid('shelter_close_job:ABC')).toBe('ABC');
		expect(shelterCloseJobUlid('ABC')).toBe('ABC');
		expect(shelterCloseLockId('sh001')).toBe('shelter_close_lock:SH001');
	});

	it('toShelterCloseJobView hides internals (FR-8)', async () => {
		const j = await create();
		const claimed = (await store.claimNext('w1'))!;
		const view = toShelterCloseJobView(claimed);
		expect(view).not.toHaveProperty('lease_owner');
		expect(view).not.toHaveProperty('_rev');
		expect(view).not.toHaveProperty('cursor');
		expect(view).not.toHaveProperty('requested_by');
		expect(view).toMatchObject({
			job_id: j.job_ulid,
			shelter_code: 'SH001',
			status: 'running',
			phase: 'people'
		});
	});
});

describe('createJob (FR-2, FR-4, FR-6, FR-7)', () => {
	it('creates central_ops + the view, the queued job and its lock', async () => {
		const j = await create('sh001', 'mgr1');
		expect(couch.dbs.has(CENTRAL)).toBe(true);
		expect(couch.get(CENTRAL, '_design/shelter_close')).toMatchObject({
			version: 1,
			views: { jobs_claimable: { map: expect.any(String) } }
		});
		expect(job('JOB001')).toMatchObject({
			type: 'shelter_close_job',
			schema_v: 1,
			shelter_code: 'SH001',
			mode: 'close',
			requested_by: 'mgr1',
			status: 'queued',
			phase: 'people',
			sweep_round: 0,
			attempt: 0,
			closed: false,
			failures: [],
			counters: { checked_out: 0, cancelled: 0, households_repaired: 0, failed: 0 },
			preview: PREVIEW,
			created_at: '2026-11-10T00:00:00.000Z'
		});
		expect(lock('SH001')).toMatchObject({
			type: 'shelter_close_lock',
			schema_v: 1,
			shelter_code: 'SH001',
			job_id: j._id
		});
	});

	it('never stores jobs or locks in a shelter db (FR-4)', async () => {
		await create();
		expect([...couch.dbs.keys()]).toEqual([CENTRAL]);
	});

	it('refuses a second job while one is active and returns the existing id (FR-7)', async () => {
		const first = await create();
		const second = await store.createJob({
			shelter_code: 'SH001',
			mode: 'close',
			requested_by: 'x',
			preview: PREVIEW
		});
		expect(second).toEqual({ created: false, job_id: first.job_ulid });
		expect(couch.byType(CENTRAL, 'shelter_close_job')).toHaveLength(1);
	});

	it('lets different shelters run jobs side by side', async () => {
		await create('SH001');
		await create('SH002');
		expect(couch.byType(CENTRAL, 'shelter_close_lock')).toHaveLength(2);
	});

	it('loses the lock race cleanly: the unclaimed job is deleted, the winner reported (FR-2)', async () => {
		// A first creator already holds the lock, but this creator's lock read still sees none.
		const winner = await create('SH001');
		let hidden = false;
		couch.hook = ({ method, path }) => {
			if (!hidden && method === 'GET' && path.includes('shelter_close_lock')) {
				hidden = true;
				return { status: 404, data: { error: 'not_found' } };
			}
			return undefined;
		};
		const loser = await store.createJob({
			shelter_code: 'SH001',
			mode: 'close',
			requested_by: 'y',
			preview: PREVIEW
		});
		expect(loser).toEqual({ created: false, job_id: winner.job_ulid });
		expect(couch.byType(CENTRAL, 'shelter_close_job').map((d) => d._id)).toEqual([winner._id]);
		expect(lock('SH001')?.job_id).toBe(winner._id);
	});

	it('takes a lock after the previous job ended (FR-3a)', async () => {
		const first = await create();
		await store.claimNext('w1');
		await store.finishJob(job(first.job_ulid), {
			status: 'completed',
			end_reason: 'ok',
			closed: true
		});
		const again = await create();
		expect(again.job_ulid).not.toBe(first.job_ulid);
	});
});

describe('getActiveJob — stale lock clearing (FR-3a, AC-13)', () => {
	it('returns null when there is no lock', async () => {
		expect(await store.getActiveJob('SH001')).toBeNull();
	});

	it('returns the job a fresh lock points at', async () => {
		const j = await create();
		expect((await store.getActiveJob('sh001'))?.job_ulid).toBe(j.job_ulid);
	});

	it('deletes a lock that points at a terminal job', async () => {
		const j = await create();
		couch.put(CENTRAL, { ...job(j.job_ulid), status: 'completed', phase: 'done' });
		expect(await store.getActiveJob('SH001')).toBeNull();
		expect(lock('SH001')).toBeUndefined();
	});

	it('deletes a lock that points at a missing job', async () => {
		const j = await create();
		couch.remove(CENTRAL, j._id);
		expect(await store.getActiveJob('SH001')).toBeNull();
		expect(lock('SH001')).toBeUndefined();
	});

	it('does not touch a job that is only just inside staleMs', async () => {
		await create();
		now = T0 + 10_000;
		expect(await store.getActiveJob('SH001')).not.toBeNull();
		expect(job('JOB001').status).toBe('queued');
	});

	it('closes a job idle for more than staleMs as completed_with_errors / stale and frees the lock', async () => {
		await create();
		now = T0 + 10_001;
		expect(await store.getActiveJob('SH001')).toBeNull();
		expect(job('JOB001')).toMatchObject({
			status: 'completed_with_errors',
			phase: 'done',
			end_reason: 'stale',
			finished_at: new Date(now).toISOString()
		});
		expect(lock('SH001')).toBeUndefined();
		// ... and a new close can start.
		expect((await create()).job_ulid).toBe('JOB002');
	});

	it('aborts when the job _rev moved meanwhile (a worker is alive): job stays active, lock kept', async () => {
		await create();
		now = T0 + 20_000;
		let bumped = false;
		couch.hook = ({ method, path }) => {
			if (!bumped && method === 'PUT' && path.includes('shelter_close_job')) {
				bumped = true;
				// the worker saved progress between our read and our CAS write
				couch.put(CENTRAL, {
					...job('JOB001'),
					status: 'running',
					updated_at: new Date(now).toISOString()
				});
			}
			return undefined;
		};
		const active = await store.getActiveJob('SH001');
		expect(active?.job_ulid).toBe('JOB001');
		expect(job('JOB001')).toMatchObject({ status: 'running' });
		expect(job('JOB001').end_reason).toBeUndefined();
		expect(lock('SH001')).toBeDefined();
	});
});

describe('self-heal after central_ops removed under a running store', () => {
	it('createJob re-creates the db + design doc and succeeds', async () => {
		await create('SH001'); // primes the per-store `ready` cache
		couch.dbs.delete(CENTRAL); // DB reset / restore while the server keeps running
		const res = await store.createJob({
			shelter_code: 'SH002',
			mode: 'close',
			requested_by: 'mgr1',
			preview: PREVIEW
		});
		expect(res.created).toBe(true);
		expect(couch.get(CENTRAL, '_design/shelter_close')).toBeTruthy();
	});

	it('claimNext recovers when only the design doc was removed', async () => {
		await create('SH001');
		couch.dbs.get(CENTRAL)!.delete('_design/shelter_close');
		const claimed = await store.claimNext('w1'); // view re-created + queried, no throw
		expect(claimed?.shelter_code).toBe('SH001');
		expect(couch.get(CENTRAL, '_design/shelter_close')).toBeTruthy();
	});

	it('still throws when the retry also fails (no retry loop)', async () => {
		await create('SH001');
		couch.dbs.delete(CENTRAL);
		couch.hook = ({ method, db, path }) =>
			method === 'PUT' && db === CENTRAL && path.includes('shelter_close_job')
				? { status: 404, data: { error: 'not_found' } }
				: undefined;
		await expect(
			store.createJob({
				shelter_code: 'SH003',
				mode: 'close',
				requested_by: 'mgr1',
				preview: PREVIEW
			})
		).rejects.toThrow(/Could not write/);
	});
});

describe('claimNext (FR-12..FR-14)', () => {
	it('returns null when nothing is claimable', async () => {
		expect(await store.claimNext('w1')).toBeNull();
	});

	it('claims the oldest queued job through the view, never scanning central_ops (FR-1)', async () => {
		await create('SH001');
		now += 5;
		await create('SH002');
		const claimed = (await store.claimNext('w1'))!;
		expect(claimed).toMatchObject({
			job_ulid: 'JOB001',
			status: 'running',
			lease_owner: 'w1',
			attempt: 1,
			started_at: new Date(T0 + 5).toISOString(),
			lease_until: new Date(T0 + 5 + 1000).toISOString()
		});
		expect(couch.viewReads).toBeGreaterThan(0);
		expect(couch.allDocsScans.get(CENTRAL)).toBeUndefined();
		const viewCall = couch.log.find((l) => l.path.includes('/_view/jobs_claimable'))!;
		expect(viewCall.path).toContain('include_docs=true');
		expect(viewCall.path).toContain('startkey=');
		expect(viewCall.path).toContain('endkey=');
		expect(viewCall.path).toContain('limit=');
	});

	it('skips a job whose shelter lock points elsewhere', async () => {
		const j = await create();
		couch.remove(CENTRAL, shelterCloseLockId('SH001'));
		expect(await store.claimNext('w1')).toBeNull();
		expect(job(j.job_ulid).status).toBe('queued');
	});

	it('does not take a job another worker holds with an unexpired lease', async () => {
		await create();
		await store.claimNext('w1');
		now += 999;
		expect(await store.claimNext('w2')).toBeNull();
		expect(job('JOB001').lease_owner).toBe('w1');
	});

	it('continues its own running job, renewing the lease without a new attempt', async () => {
		await create();
		await store.claimNext('w1');
		now += 500;
		const again = (await store.claimNext('w1'))!;
		expect(again).toMatchObject({ job_ulid: 'JOB001', attempt: 1, lease_owner: 'w1' });
		expect(again.lease_until).toBe(new Date(now + 1000).toISOString());
	});

	it('takes over an expired lease from another worker: attempt + 1, cursor kept', async () => {
		await create();
		const first = (await store.claimNext('w1'))!;
		await store.saveProgress(first, { cursor: { after: 'K1' }, phase: 'households' }, 'w1');
		now += 1001; // lease expired
		const takeover = (await store.claimNext('w2'))!;
		expect(takeover).toMatchObject({
			lease_owner: 'w2',
			attempt: 2,
			phase: 'households',
			cursor: { after: 'K1' }
		});
	});

	it('ends a job as attempts_exhausted instead of a takeover beyond maxAttempts (FR-14)', async () => {
		await create();
		for (let i = 1; i <= 3; i++) {
			expect((await store.claimNext(`w${i}`))!.attempt).toBe(i);
			now += 1001;
		}
		expect(await store.claimNext('w4')).toBeNull();
		expect(job('JOB001')).toMatchObject({
			status: 'completed_with_errors',
			end_reason: 'attempts_exhausted',
			phase: 'done'
		});
		expect(lock('SH001')).toBeUndefined();
	});

	it('moves on to the next candidate when its claim CAS is lost', async () => {
		await create('SH001');
		now += 5;
		await create('SH002');
		let raced = false;
		couch.hook = ({ method, path }) => {
			if (!raced && method === 'PUT' && path.includes('shelter_close_job%3AJOB001')) {
				raced = true;
				couch.put(CENTRAL, {
					...job('JOB001'),
					status: 'running',
					lease_owner: 'other',
					lease_until: new Date(now + 1000).toISOString()
				});
			}
			return undefined;
		};
		const claimed = (await store.claimNext('w1'))!;
		expect(claimed.job_ulid).toBe('JOB002');
		expect(job('JOB001').lease_owner).toBe('other');
	});

	it('does not claim finished jobs', async () => {
		await create();
		const j = (await store.claimNext('w1'))!;
		await store.finishJob(j, { status: 'completed', end_reason: 'ok', closed: true });
		expect(await store.claimNext('w1')).toBeNull();
	});
});

describe('saveProgress (FR-12, FR-13)', () => {
	it('writes the patch, bumps updated_at and extends the lease', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		now += 400;
		const saved = (await store.saveProgress(
			claimed,
			{ cursor: { after: 'A' }, counters: { ...claimed.counters, checked_out: 3 } },
			'w1'
		))!;
		expect(saved.cursor).toEqual({ after: 'A' });
		expect(job('JOB001')).toMatchObject({
			counters: { checked_out: 3 },
			updated_at: new Date(now).toISOString(),
			lease_until: new Date(now + 1000).toISOString(),
			lease_owner: 'w1'
		});
	});

	it('retries once on a fresh _rev when the 409 came from our own earlier write', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		// someone (e.g. a stale-clear attempt that was aborted) touched the doc but we still own it
		couch.put(CENTRAL, { ...job('JOB001'), updated_at: 'x' });
		const saved = await store.saveProgress(claimed, { cursor: { after: 'B' } }, 'w1');
		expect(saved?.cursor).toEqual({ after: 'B' });
		expect(job('JOB001').cursor).toEqual({ after: 'B' });
	});

	it('stops (null) and does not overwrite when another worker took the lease', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		couch.put(CENTRAL, { ...job('JOB001'), lease_owner: 'w2', cursor: { after: 'W2' } });
		expect(await store.saveProgress(claimed, { cursor: { after: 'W1' } }, 'w1')).toBeNull();
		expect(job('JOB001')).toMatchObject({ lease_owner: 'w2', cursor: { after: 'W2' } });
	});

	it('stops (null) when the job went terminal under us', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		couch.put(CENTRAL, {
			...job('JOB001'),
			status: 'completed_with_errors',
			phase: 'done',
			end_reason: 'stale'
		});
		expect(await store.saveProgress(claimed, { cursor: { after: 'Z' } }, 'w1')).toBeNull();
		expect(job('JOB001')).toMatchObject({ status: 'completed_with_errors', end_reason: 'stale' });
	});

	it('stops (null) when the job vanished', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		couch.put(CENTRAL, { ...job('JOB001') }); // stale rev -> 409
		couch.remove(CENTRAL, claimed._id);
		expect(await store.saveProgress(claimed, {}, 'w1')).toBeNull();
	});

	it('stops (null) when the retry also loses the CAS', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		couch.put(CENTRAL, { ...job('JOB001') });
		let puts = 0;
		couch.hook = ({ method, path }) => {
			if (method === 'PUT' && path.includes('shelter_close_job')) {
				puts += 1;
				if (puts === 2) return { status: 409, data: { error: 'conflict' } };
			}
			return undefined;
		};
		expect(await store.saveProgress(claimed, { cursor: { after: 'Q' } }, 'w1')).toBeNull();
	});

	it('surfaces a non-409 failure as an error', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		couch.hook = ({ method, path }) =>
			method === 'PUT' && path.includes('shelter_close_job')
				? { status: 500, data: {} }
				: undefined;
		await expect(store.saveProgress(claimed, {}, 'w1')).rejects.toThrow(/Could not write/);
	});
});

describe('finishOwnedJob / finishJob (FR-3, FR-22)', () => {
	it('writes the terminal state, clears the lease and releases the lock', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		const done = (await store.finishOwnedJob(
			claimed,
			{ status: 'completed', end_reason: 'ok', closed: true },
			'w1'
		))!;
		expect(done).toMatchObject({
			status: 'completed',
			end_reason: 'ok',
			closed: true,
			phase: 'done'
		});
		expect(job('JOB001').lease_owner).toBeUndefined();
		expect(job('JOB001').finished_at).toBeDefined();
		expect(lock('SH001')).toBeUndefined();
	});

	it('stops on 409 when the job is terminal already: no overwrite, lock untouched by us', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		couch.put(CENTRAL, {
			...job('JOB001'),
			status: 'completed_with_errors',
			phase: 'done',
			end_reason: 'stale'
		});
		expect(
			await store.finishOwnedJob(
				claimed,
				{ status: 'completed', end_reason: 'ok', closed: true },
				'w1'
			)
		).toBeNull();
		expect(job('JOB001')).toMatchObject({ end_reason: 'stale', status: 'completed_with_errors' });
	});

	it('stops on 409 when another worker owns the lease', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		couch.put(CENTRAL, { ...job('JOB001'), lease_owner: 'w2' });
		expect(
			await store.finishOwnedJob(
				claimed,
				{ status: 'completed', end_reason: 'ok', closed: true },
				'w1'
			)
		).toBeNull();
		expect(job('JOB001').status).toBe('running');
	});

	it('retries on a fresh _rev while still the owner', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		couch.put(CENTRAL, { ...job('JOB001') });
		const done = await store.finishOwnedJob(
			claimed,
			{ status: 'completed', end_reason: 'ok', closed: true },
			'w1'
		);
		expect(done?.status).toBe('completed');
	});

	it('releaseLock only removes the lock of the job that holds it', async () => {
		const a = await create('SH001');
		await store.releaseLock('SH001', 'shelter_close_job:OTHER');
		expect(lock('SH001')?.job_id).toBe(a._id);
		await store.releaseLock('SH001', a._id);
		expect(lock('SH001')).toBeUndefined();
	});
});

describe('abandonLease', () => {
	it('drops the owner and expires the lease so any worker can take it over (attempt counted)', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		await store.abandonLease(claimed);
		expect(job('JOB001').lease_owner).toBeUndefined();
		const taken = (await store.claimNext('w2'))!;
		expect(taken).toMatchObject({ lease_owner: 'w2', attempt: 2 });
	});

	it('ignores a lost CAS', async () => {
		await create();
		const claimed = (await store.claimNext('w1'))!;
		couch.put(CENTRAL, { ...job('JOB001') });
		await expect(store.abandonLease(claimed)).resolves.toBeUndefined();
	});
});

describe('ensureDesign', () => {
	it('is created once per store and redeployed when the version differs', async () => {
		await store.ensureDesign();
		await store.ensureDesign();
		expect(couch.log.filter((l) => l.method === 'PUT' && l.path.includes('_design'))).toHaveLength(
			1
		);
		const cur = couch.get(CENTRAL, '_design/shelter_close')!;
		couch.put(CENTRAL, { ...cur, version: 0, views: {} });
		await make().ensureDesign();
		expect(couch.get(CENTRAL, '_design/shelter_close')).toMatchObject({ version: 1 });
	});

	it('tolerates an existing central_ops (412) and fails on other errors', async () => {
		couch.createDb(CENTRAL);
		await expect(store.ensureDesign()).resolves.toBeUndefined();
		const broken = new FakeCouchServer();
		broken.hook = () => ({ status: 500, data: {} });
		await expect(
			createShelterCloseJobStore({ couchReq: broken.req }).ensureDesign()
		).rejects.toThrow(/Could not ensure/);
	});
});
