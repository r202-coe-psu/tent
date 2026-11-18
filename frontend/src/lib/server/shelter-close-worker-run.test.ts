import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { FakeCouchServer, type FakeDoc } from './test-support/fake-couch-multi-db';
import {
	createShelterCloseJobStore,
	type ShelterCloseJob,
	type ShelterCloseJobStore
} from './shelter-close-job';
import {
	runShelterCloseWorkerStep,
	type ShelterCloseRegistryShelter,
	type ShelterCloseWorkerResult
} from './shelter-close-worker-run';
import { SHELTER_CLOSE_CHUNK_SIZE, previewShelterClose } from './shelter-close';
import { BACKFILL_CREATED_BY } from './closed-shelter-checkout-backfill';

const T0 = Date.parse('2026-11-10T00:00:00.000Z');
const CENTRAL = 'central_ops';
const SHELTER = 'shelter_sh001';

let couch: FakeCouchServer;
let now: number;
let ulidSeq: number;
let registry: ShelterCloseRegistryShelter | null;
let closeShelter: Mock<(code: string) => Promise<void>>;
let seq: number;

const config = {
	leaseMs: 1000,
	staleMs: 100_000,
	chunkBudgetMs: 500,
	maxAttempts: 3,
	maxFailures: 50
};

function makeStore(over: Partial<typeof config> = {}): ShelterCloseJobStore {
	return createShelterCloseJobStore({
		couchReq: couch.req,
		now: () => now,
		ulid: () => `JOB${String(++ulidSeq).padStart(3, '0')}`,
		config: { ...config, ...over }
	});
}

let store: ShelterCloseJobStore;

beforeEach(() => {
	couch = new FakeCouchServer();
	couch.createDb(SHELTER);
	now = T0;
	ulidSeq = 0;
	seq = 0;
	registry = { closed: false, closed_at: null };
	closeShelter = vi.fn<(code: string) => Promise<void>>(async () => {
		registry = { closed: true, closed_at: new Date(now).toISOString() };
	});
	store = makeStore();
});

function addHousehold(status = 'checked_in') {
	seq += 1;
	const id = `household:H${String(seq).padStart(5, '0')}`;
	couch.put(SHELTER, {
		_id: id,
		type: 'household',
		schema_v: 5,
		shelter_code: 'SH001',
		status,
		checkout_destination: null,
		updated_at: '2026-10-01T00:00:00.000Z'
	});
	return id;
}

function addEvacuee(status: string, householdId: string | null = null) {
	seq += 1;
	const id = `evacuee:E${String(seq).padStart(5, '0')}`;
	couch.put(SHELTER, {
		_id: id,
		type: 'evacuee',
		schema_v: 5,
		shelter_code: 'SH001',
		household_id: householdId,
		first_name: 'ก',
		current_stay: { status, zone: 'Z1', since: '2026-10-01T00:00:00.000Z' },
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'staff'
	});
	return id;
}

const stay = (id: string) => (couch.get(SHELTER, id)!.current_stay as { status: string }).status;
const jobDoc = (n = 1) =>
	couch.get(
		CENTRAL,
		`shelter_close_job:JOB${String(n).padStart(3, '0')}`
	) as unknown as ShelterCloseJob;

async function createJob(mode: 'close' | 'backfill' = 'close', requested_by = 'mgr1') {
	const preview = await previewShelterClose(couch.req, 'SH001');
	const res = await store.createJob({ shelter_code: 'SH001', mode, requested_by, preview });
	if (!res.created) throw new Error('job not created');
	return res.job;
}

function step(workerId = 'w1', s: ShelterCloseJobStore = store) {
	return runShelterCloseWorkerStep({
		store: s,
		couchReq: couch.req,
		workerId,
		now: () => now,
		readShelter: async () => registry,
		closeShelter
	});
}

type Progress = Extract<ShelterCloseWorkerResult, { kind: 'progress' }>;

/** Run steps until the job is terminal or `max` steps; `after` runs between steps. */
async function drain(
	opts: { max?: number; workerId?: string; after?: (r: Progress, i: number) => void } = {}
) {
	const phases: string[] = [];
	for (let i = 0; i < (opts.max ?? 60); i++) {
		const r = await step(opts.workerId ?? 'w1');
		if (r.kind === 'idle') return { phases, idle: true };
		phases.push(`${r.job.phase}`);
		opts.after?.(r, i);
		if (r.job.status === 'completed' || r.job.status === 'completed_with_errors') {
			return { phases, idle: false };
		}
	}
	throw new Error('did not finish');
}

describe('runShelterCloseWorkerStep — idle', () => {
	it('is idle without a claimable job (the route answers 204)', async () => {
		expect(await step()).toEqual({ kind: 'idle' });
	});
});

describe('phases and finalize close (FR-17..FR-22, AC-15)', () => {
	it('walks people → households → sweep → finalize → done and closes the registry once', async () => {
		const h = addHousehold();
		const a = addEvacuee('active', h);
		const b = addEvacuee('temporary_leave', h);
		const pre = addEvacuee('pre_registered', null);
		await createJob('close', 'mgr1');

		const { phases } = await drain();
		// phase recorded AFTER each call: chunk, empty-chunk → next phase, ...
		expect(phases).toEqual(['people', 'households', 'households', 'sweep', 'finalize', 'done']);
		expect(closeShelter).toHaveBeenCalledTimes(1);
		expect(closeShelter).toHaveBeenCalledWith('SH001');

		expect(jobDoc()).toMatchObject({
			status: 'completed',
			phase: 'done',
			end_reason: 'ok',
			closed: true,
			counters: { checked_out: 2, cancelled: 1, failed: 0 }
		});
		expect(jobDoc().lease_owner).toBeUndefined();
		expect(couch.get(CENTRAL, 'shelter_close_lock:SH001')).toBeUndefined();

		expect(stay(a)).toBe('checked_out');
		expect(stay(b)).toBe('checked_out');
		expect(stay(pre)).toBe('cancelled');
		expect(couch.get(SHELTER, h)).toMatchObject({
			status: 'checked_out',
			checkout_destination: { type: 'shelter_closed' }
		});
	});

	it('writes movements authored by requested_by, never the worker id (FR-10a, AC-15)', async () => {
		const h = addHousehold();
		addEvacuee('active', h);
		const pre = addHousehold('pre_registered');
		addEvacuee('pre_registered', pre);
		await createJob('close', 'sm.somchai');
		await drain({ workerId: 'worker-xyz' });

		const movements = couch.byType(SHELTER, 'movement');
		expect(movements).toHaveLength(1);
		expect(movements[0]).toMatchObject({ created_by: 'sm.somchai', reason: 'shelter_closed' });
		const audits = couch.byType(SHELTER, 'audit');
		expect(audits.length).toBeGreaterThan(0);
		for (const doc of [...movements, ...audits]) {
			expect(doc.created_by).toBe('sm.somchai');
			expect(JSON.stringify(doc)).not.toContain('worker-xyz');
		}
	});

	it('an empty shelter still reaches finalize and closes (nothing to check out)', async () => {
		await createJob();
		await drain();
		expect(jobDoc()).toMatchObject({
			status: 'completed',
			closed: true,
			counters: { checked_out: 0 }
		});
		expect(closeShelter).toHaveBeenCalledTimes(1);
	});

	it('leaves an already-closed registry alone (FR-20)', async () => {
		registry = { closed: true, closed_at: '2026-10-01T00:00:00.000Z' };
		addEvacuee('active');
		await createJob();
		await drain();
		expect(closeShelter).not.toHaveBeenCalled();
		expect(jobDoc()).toMatchObject({ status: 'completed', closed: false }); // not closed BY this job
	});

	it('repairs a household whose members are already closed out (FR-18)', async () => {
		const h = addHousehold('checked_in'); // stale: every member is checked_out
		addEvacuee('checked_out', h);
		await createJob();
		await drain();
		expect(couch.get(SHELTER, h)).toMatchObject({ status: 'checked_out' });
		expect(jobDoc().counters.households_repaired).toBe(1);
	});

	it('never writes the registry itself — only through the injected closeShelter (FR-20)', async () => {
		addEvacuee('active');
		await createJob();
		await drain();
		expect([...couch.dbs.keys()].sort()).toEqual([CENTRAL, SHELTER]);
	});
});

describe('cursor resume (FR-12, FR-14, AC-5)', () => {
	const N = SHELTER_CLOSE_CHUNK_SIZE * 2 + 50;

	it('processes one chunk per call and persists the cursor + counters', async () => {
		for (let i = 0; i < N; i++) addEvacuee('active');
		await createJob();
		const r = (await step()) as Progress;
		expect(r.job.phase).toBe('people');
		expect(r.job.counters.checked_out).toBe(SHELTER_CLOSE_CHUNK_SIZE);
		expect(jobDoc().cursor.after).toBeTruthy();
		expect(couch.byType(SHELTER, 'movement')).toHaveLength(SHELTER_CLOSE_CHUNK_SIZE);
	});

	it('another worker resumes after the lease expires: every person has exactly one movement', async () => {
		for (let i = 0; i < N; i++) addEvacuee('active');
		await createJob();
		await step('w1'); // chunk 1, then w1 is killed
		now += 1001;
		const resumed = (await step('w2')) as Progress;
		expect(resumed.job.attempt).toBe(2);
		expect(resumed.job.lease_owner).toBe('w2');
		await drain({ workerId: 'w2' });

		const movements = couch.byType(SHELTER, 'movement');
		expect(movements).toHaveLength(N);
		expect(new Set(movements.map((m) => m.evacuee_id)).size).toBe(N);
		expect(jobDoc()).toMatchObject({ status: 'completed', counters: { checked_out: N } });
		expect(
			couch
				.byType(SHELTER, 'evacuee')
				.every((e) => (e.current_stay as { status: string }).status === 'checked_out')
		).toBe(true);
	});

	it('a failed movement request mid-chunk is retried / re-done: no duplicate movements', async () => {
		for (let i = 0; i < 10; i++) addEvacuee('active');
		await createJob();
		// The chunk's evacuee writes land, the movement write fails → rollback keeps it consistent,
		// the job is abandoned and a second worker redoes the chunk.
		let boom = true;
		couch.hook = ({ method, db, path }) =>
			boom &&
			db === SHELTER &&
			method === 'POST' &&
			path.includes('_bulk_docs') &&
			couch.bulkLog.length >= 1
				? ((boom = false), { status: 500, data: { error: 'unknown_error' } })
				: undefined;
		await drain({ workerId: 'w1', max: 1 }).catch(() => undefined);
		now += 1001;
		await drain({ workerId: 'w2' });
		const movements = couch.byType(SHELTER, 'movement');
		expect(new Set(movements.map((m) => m.evacuee_id)).size).toBe(movements.length);
		expect(movements).toHaveLength(10);
		expect(jobDoc().status).toBe('completed');
	});

	it('propagates a chunk error and gives the lease up so another worker can take over (attempt counted)', async () => {
		addEvacuee('active');
		await createJob();
		couch.hook = ({ db, path }) =>
			db === SHELTER && path.includes('_all_docs')
				? { status: 500, data: { error: 'boom' } }
				: undefined;
		await expect(step('w1')).rejects.toThrow();
		expect(jobDoc().lease_owner).toBeUndefined();
		couch.hook = null;
		const next = (await step('w2')) as Progress;
		expect(next.job.attempt).toBe(2);
		expect(next.job.lease_owner).toBe('w2');
	});

	it('ends attempts_exhausted when chunks keep failing past maxAttempts (FR-14)', async () => {
		addEvacuee('active');
		await createJob();
		couch.hook = ({ db, path }) =>
			db === SHELTER && path.includes('_all_docs') ? { status: 500, data: {} } : undefined;
		for (let i = 0; i < 3; i++) await expect(step(`w${i}`)).rejects.toThrow();
		expect(await step('w9')).toEqual({ kind: 'idle' });
		expect(jobDoc()).toMatchObject({
			status: 'completed_with_errors',
			end_reason: 'attempts_exhausted'
		});
		expect(closeShelter).not.toHaveBeenCalled();
		expect(couch.get(CENTRAL, 'shelter_close_lock:SH001')).toBeUndefined();
	});
});

describe('chunk budget (FR-12)', () => {
	it('drops a chunk that overran SHELTER_CLOSE_CHUNK_BUDGET_MS, keeps the cursor and gives the lease up', async () => {
		for (let i = 0; i < 5; i++) addEvacuee('active');
		await createJob();
		let slow = true;
		couch.hook = ({ db }) => {
			if (slow && db === SHELTER) now += 600; // the first shelter read alone exceeds the 500 ms budget
			return undefined;
		};
		const r = (await step()) as Progress;
		expect(r.budget_exceeded).toBe(true);
		expect(r.stopped).toBe(false);
		expect(jobDoc()).toMatchObject({
			phase: 'people',
			cursor: {},
			counters: { checked_out: 0 }
		});
		// Lease released (already expired) so the next claim is a takeover that counts an attempt.
		expect(jobDoc().lease_owner).toBeUndefined();
		expect(jobDoc().lease_until).toBe(new Date(now).toISOString());
		expect(couch.byType(SHELTER, 'movement')).toHaveLength(0);

		slow = false;
		await drain();
		expect(couch.byType(SHELTER, 'movement')).toHaveLength(5);
		expect(jobDoc().status).toBe('completed');
	});

	it('lets a chunk finish once it has started writing: no checked-out person without a movement', async () => {
		for (let i = 0; i < 5; i++) addEvacuee('active');
		await createJob();
		let bulk = 0;
		couch.hook = ({ db, method, path }) => {
			if (db === SHELTER && method === 'POST' && path.includes('_bulk_docs')) {
				bulk += 1;
				if (bulk === 1) now += 600; // evacuee write lands, then the budget is spent
			}
			return undefined;
		};
		const r = (await step()) as Progress;
		expect(r.budget_exceeded).toBe(false);
		couch.hook = null;
		await drain();
		const checkedOut = (couch.byType(SHELTER, 'evacuee') as FakeDoc[]).filter(
			(e) => (e.current_stay as { status: string }).status === 'checked_out'
		).length;
		expect(checkedOut).toBe(5);
		expect(couch.byType(SHELTER, 'movement')).toHaveLength(5);
		expect(jobDoc()).toMatchObject({ status: 'completed', counters: { checked_out: 5 } });
	});

	it('ends attempts_exhausted when every chunk overruns the budget (no endless loop)', async () => {
		addEvacuee('active');
		await createJob();
		couch.hook = ({ db }) => {
			if (db === SHELTER) now += 600;
			return undefined;
		};
		for (let i = 0; i < 20 && jobDoc().status !== 'completed_with_errors'; i++) {
			await step();
			now += 1; // lease abandoned at `now`; let it read as expired
		}
		expect(jobDoc()).toMatchObject({
			status: 'completed_with_errors',
			end_reason: 'attempts_exhausted'
		});
		expect(closeShelter).not.toHaveBeenCalled();
		expect(couch.get(CENTRAL, 'shelter_close_lock:SH001')).toBeUndefined();
	});

	it('does not overwrite a lease taken by another worker while over budget', async () => {
		addEvacuee('active');
		await createJob();
		couch.hook = ({ db }) => {
			if (db === SHELTER) {
				now += 600;
				couch.put(CENTRAL, { ...jobDoc(), lease_owner: 'other' });
			}
			return undefined;
		};
		const r = (await step()) as Progress;
		expect(r).toMatchObject({ budget_exceeded: true });
		expect(jobDoc().lease_owner).toBe('other');
	});
});

describe('stopping on 409 (FR-13, AC-13)', () => {
	it('stops without overwriting when another worker took the lease mid-chunk', async () => {
		for (let i = 0; i < 3; i++) addEvacuee('active');
		await createJob();
		couch.hook = ({ db, method, path }) => {
			if (db === SHELTER && method === 'POST' && path.includes('_bulk_docs')) {
				couch.put(CENTRAL, { ...jobDoc(), lease_owner: 'w2', cursor: { after: 'W2' } });
			}
			return undefined;
		};
		const r = (await step('w1')) as Progress;
		expect(r.stopped).toBe(true);
		expect(jobDoc()).toMatchObject({ lease_owner: 'w2', cursor: { after: 'W2' } });
	});

	it('stops when the job was closed as stale mid-chunk and does not reopen it', async () => {
		addEvacuee('active');
		await createJob();
		couch.hook = ({ db, method, path }) => {
			if (db === SHELTER && method === 'POST' && path.includes('_bulk_docs')) {
				couch.put(CENTRAL, {
					...jobDoc(),
					status: 'completed_with_errors',
					phase: 'done',
					end_reason: 'stale'
				});
			}
			return undefined;
		};
		const r = (await step()) as Progress;
		expect(r.stopped).toBe(true);
		expect(jobDoc()).toMatchObject({ status: 'completed_with_errors', end_reason: 'stale' });
		expect(closeShelter).not.toHaveBeenCalled();
	});
});

describe('sweep (FR-19, AC-6)', () => {
	it('goes back to people (sweep_round + 1) when someone checked in meanwhile, then closes', async () => {
		addEvacuee('active');
		await createJob();
		let injected = false;
		let late = '';
		const { phases } = await drain({
			after: (r) => {
				if (!injected && r.job.phase === 'sweep') {
					injected = true;
					late = addEvacuee('active');
				}
			}
		});
		expect(phases).toEqual([
			'people',
			'households',
			'sweep',
			'people', // sweep found the late arrival -> round 1
			'people',
			'households',
			'sweep',
			'finalize',
			'done'
		]);
		expect(stay(late)).toBe('checked_out');
		expect(jobDoc()).toMatchObject({ status: 'completed', sweep_round: 1, closed: true });
	});

	it('gives up after 3 rounds: completed_with_errors / sweep_exhausted, shelter not closed', async () => {
		addEvacuee('active');
		await createJob();
		await drain({
			after: (r) => {
				if (r.job.phase === 'sweep') addEvacuee('active'); // a new arrival every round
			}
		});
		expect(jobDoc()).toMatchObject({
			status: 'completed_with_errors',
			end_reason: 'sweep_exhausted',
			sweep_round: 3,
			closed: false,
			phase: 'done'
		});
		expect(closeShelter).not.toHaveBeenCalled();
		expect(registry?.closed).toBe(false);
		expect(couch.get(CENTRAL, 'shelter_close_lock:SH001')).toBeUndefined();
	});

	it('a person who keeps failing ends sweep_exhausted, not failed (precedence), shelter stays open', async () => {
		const stuck = addEvacuee('active');
		addEvacuee('active');
		couch.bulkFault = (doc) =>
			doc._id === stuck ? { error: 'conflict', reason: 'Document update conflict.' } : null;
		await createJob();
		await drain();
		expect(jobDoc()).toMatchObject({
			status: 'completed_with_errors',
			end_reason: 'sweep_exhausted'
		});
		expect(jobDoc().failures).toEqual([
			{ evacuee_id: stuck, error: 'conflict: Document update conflict.' }
		]);
		expect(closeShelter).not.toHaveBeenCalled();
		expect(stay(stuck)).toBe('active');
	});

	it('closing again after the fault clears creates a new job that finishes the work (AC-7)', async () => {
		const stuck = addEvacuee('active');
		couch.bulkFault = (doc) => (doc._id === stuck ? { error: 'conflict', reason: 'x' } : null);
		await createJob();
		await drain();
		expect(closeShelter).not.toHaveBeenCalled();
		couch.bulkFault = null;
		const second = await createJob();
		expect(second.job_ulid).toBe('JOB002');
		await drain();
		expect(stay(stuck)).toBe('checked_out');
		expect(jobDoc(2)).toMatchObject({ status: 'completed', closed: true });
		expect(closeShelter).toHaveBeenCalledTimes(1);
		expect(couch.byType(SHELTER, 'movement')).toHaveLength(1);
	});
});

describe('failures[] (FR-22, FR-24)', () => {
	// Household writes fail, people still check out: re-count is 0 so the job reaches finalize.
	function failHouseholds() {
		couch.bulkFault = (doc) =>
			doc.type === 'household' ? { error: 'forbidden', reason: 'nope' } : null;
	}

	it('finalize with failed > 0 → completed_with_errors / failed, registry untouched (FR-20, FR-22)', async () => {
		const h = addHousehold();
		addEvacuee('active', h);
		failHouseholds();
		await createJob();
		await drain();
		expect(jobDoc()).toMatchObject({
			status: 'completed_with_errors',
			end_reason: 'failed',
			closed: false
		});
		expect(jobDoc().counters.failed).toBeGreaterThan(0);
		expect(jobDoc().failures.length).toBeGreaterThan(0);
		expect(closeShelter).not.toHaveBeenCalled();
	});

	it('caps failures[] at maxFailures while counters.failed keeps counting (FR-24)', async () => {
		store = makeStore({ maxFailures: 2 });
		for (let i = 0; i < 5; i++) addEvacuee('active', addHousehold());
		failHouseholds();
		await createJob();
		await drain();
		const job = jobDoc();
		expect(job.counters.failed).toBeGreaterThan(2);
		expect(job.failures).toHaveLength(2);
	});
});

describe('finalize backfill (FR-21, AC-8, AC-15)', () => {
	it('never touches the registry, writes one summary audit authored by BACKFILL_CREATED_BY', async () => {
		registry = { closed: true, closed_at: '2026-10-01T00:00:00.000Z' };
		const h = addHousehold();
		const a = addEvacuee('active', h);
		addEvacuee('pre_registered', null);
		await createJob('backfill', BACKFILL_CREATED_BY);
		await drain();

		expect(closeShelter).not.toHaveBeenCalled();
		expect(registry).toEqual({ closed: true, closed_at: '2026-10-01T00:00:00.000Z' });
		expect(jobDoc()).toMatchObject({
			mode: 'backfill',
			status: 'completed',
			end_reason: 'ok',
			closed: false
		});
		expect(stay(a)).toBe('checked_out');

		const movements = couch.byType(SHELTER, 'movement');
		expect(movements).toHaveLength(1);
		expect(movements[0].created_by).toBe(BACKFILL_CREATED_BY);

		const summaries = couch
			.byType(SHELTER, 'audit')
			.filter((x) => x.target_type === 'shelter' && x.target_id === 'SH001');
		expect(summaries).toHaveLength(1);
		expect(summaries[0]).toMatchObject({
			created_by: BACKFILL_CREATED_BY,
			context: {
				backfill: true,
				shelter_closed_at: '2026-10-01T00:00:00.000Z',
				checked_out: 1,
				cancelled: 1
			}
		});
		// the per-household cancel audit carries the backfill context too (CR-219 FR-30)
		for (const audit of couch.byType(SHELTER, 'audit')) {
			expect((audit.context as { backfill?: boolean }).backfill).toBe(true);
			expect(audit.created_by).toBe(BACKFILL_CREATED_BY);
		}
	});

	it('writes no audit when there was nothing to do (idempotent re-run)', async () => {
		registry = { closed: true, closed_at: '2026-10-01T00:00:00.000Z' };
		addEvacuee('checked_out');
		await createJob('backfill', BACKFILL_CREATED_BY);
		await drain();
		expect(couch.byType(SHELTER, 'audit')).toHaveLength(0);
		expect(jobDoc().status).toBe('completed');
	});

	it('backfill with failed households still finalizes: audit records failures, job completed_with_errors', async () => {
		registry = { closed: true, closed_at: null };
		const h = addHousehold();
		addEvacuee('active', h);
		couch.bulkFault = (doc) =>
			doc.type === 'household' ? { error: 'forbidden', reason: 'nope' } : null;
		await createJob('backfill', BACKFILL_CREATED_BY);
		await drain();
		expect(jobDoc()).toMatchObject({
			status: 'completed_with_errors',
			end_reason: 'failed',
			closed: false
		});
		const summary = couch.byType(SHELTER, 'audit').find((x) => x.target_type === 'shelter');
		expect((summary as FakeDoc).context).toMatchObject({ backfill: true, shelter_closed_at: null });
		expect(((summary as FakeDoc).context as { failed: number }).failed).toBeGreaterThan(0);
	});
});

describe('finalize errors', () => {
	it('abandons the lease and throws when the shelter no longer exists in the registry', async () => {
		registry = null;
		await createJob();
		await expect(drain()).rejects.toThrow(/not found/);
		expect(jobDoc().lease_owner).toBeUndefined();
		expect(jobDoc().status).toBe('running');
	});
});

describe('load (AC-11): ~5,000 people', () => {
	it('closes 5,000 people across ~2,000 households in bounded chunks with no duplicate movements', async () => {
		const total = 5000;
		let made = 0;
		while (made < total) {
			const size = Math.min(2 + (made % 2), total - made); // 2-3 members per household
			const h = addHousehold('checked_in');
			for (let i = 0; i < size; i++) addEvacuee(made % 11 === 0 ? 'pre_registered' : 'active', h);
			made += size;
		}
		await createJob();
		let steps = 0;
		await drain({ max: 400, after: () => (steps += 1) });
		const movements = couch.byType(SHELTER, 'movement');
		expect(jobDoc()).toMatchObject({
			status: 'completed',
			end_reason: 'ok',
			sweep_round: 0,
			counters: { failed: 0 },
			closed: true
		});
		expect(jobDoc().counters.checked_out + jobDoc().counters.cancelled).toBe(total);
		expect(movements.length).toBeGreaterThanOrEqual(jobDoc().counters.checked_out);
		expect(new Set(movements.map((m) => m._id)).size).toBe(movements.length);
		expect(steps).toBeGreaterThan(total / 200); // ≤200 people per chunk (FR-17)
		expect(closeShelter).toHaveBeenCalledTimes(1);
	}, 60_000);
});
