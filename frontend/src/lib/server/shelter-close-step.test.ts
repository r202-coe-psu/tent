import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Evacuee } from '$lib/features/people/server';
import { FakeCouchServer } from './test-support/fake-couch-multi-db';
import {
	SHELTER_CLOSE_MAX_SWEEPS,
	dryRunShelterClose,
	initialShelterCloseStepState,
	nextPeopleChunk,
	stepShelterClose
} from './shelter-close';

const SHELTER = 'shelter_sh001';
let couch: FakeCouchServer;
let seq = 0;

beforeEach(() => {
	couch = new FakeCouchServer();
	couch.createDb(SHELTER);
	seq = 0;
});

function addEvacuee(status: string, household: string | null = null) {
	seq += 1;
	const id = `evacuee:E${String(seq).padStart(5, '0')}`;
	couch.put(SHELTER, {
		_id: id,
		type: 'evacuee',
		schema_v: 5,
		shelter_code: 'SH001',
		household_id: household,
		current_stay: { status, zone: 'Z1', since: '2026-10-01T00:00:00.000Z' },
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'staff'
	});
	return id;
}
const ev = (id: string, household: string | null = null) =>
	({ _id: id, household_id: household }) as unknown as Evacuee;

describe('nextPeopleChunk (cursor, FR-12 / FR-17)', () => {
	it('returns nothing and a null cursor when no one is left', () => {
		expect(nextPeopleChunk([], null, 5)).toEqual({ chunk: [], cursor: null });
	});

	it('keeps a household in one chunk and resumes strictly after the cursor', () => {
		const people = [
			ev('evacuee:1', 'household:A'),
			ev('evacuee:2', 'household:A'),
			ev('evacuee:3', 'household:B'),
			ev('evacuee:4', 'household:B'),
			ev('evacuee:5', null)
		];
		const first = nextPeopleChunk(people, null, 3);
		expect(first.chunk.map((e) => e._id)).toEqual(['evacuee:1', 'evacuee:2']);
		const second = nextPeopleChunk(people, first.cursor, 3);
		expect(second.chunk.map((e) => e._id)).toEqual(['evacuee:3', 'evacuee:4', 'evacuee:5']);
		expect(nextPeopleChunk(people, second.cursor, 3)).toEqual({ chunk: [], cursor: null });
	});

	it('splits a household larger than the chunk size without skipping or repeating anyone', () => {
		const people = Array.from({ length: 5 }, (_, i) => ev(`evacuee:${i}`, 'household:A'));
		const seen: string[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 10; i++) {
			const next = nextPeopleChunk(people, cursor, 2);
			if (next.chunk.length === 0) break;
			expect(next.chunk.length).toBeLessThanOrEqual(2);
			seen.push(...next.chunk.map((e) => e._id));
			cursor = next.cursor;
		}
		expect(seen).toEqual(people.map((e) => e._id));
	});

	it('ignores people already behind the cursor even if they are still affected (failed stay behind)', () => {
		const people = [ev('evacuee:1'), ev('evacuee:2')];
		const { cursor } = nextPeopleChunk(people, null, 1);
		expect(nextPeopleChunk(people, cursor, 5).chunk.map((e) => e._id)).toEqual(['evacuee:2']);
	});
});

describe('stepShelterClose', () => {
	const options = { createdBy: 'mgr1', now: () => '2026-11-10T00:00:00.000Z' };

	it('does nothing in the done phase', async () => {
		const state = { ...initialShelterCloseStepState(), phase: 'done' as const };
		const res = await stepShelterClose(couch.req, 'SH001', state, options);
		expect(res).toEqual({ state, outcome: null });
		expect(couch.log).toHaveLength(0);
	});

	it('is capped at three sweeps', () => {
		expect(SHELTER_CLOSE_MAX_SWEEPS).toBe(3);
	});

	it('finalize calls the injected finalize exactly when nobody failed (close mode, FR-20)', async () => {
		const finalize = vi.fn(async () => ({ closed: true }));
		const ok = await stepShelterClose(
			couch.req,
			'SH001',
			{ ...initialShelterCloseStepState(), phase: 'finalize' },
			{ ...options, finalize }
		);
		expect(finalize).toHaveBeenCalledTimes(1);
		expect(ok.outcome).toEqual({ status: 'completed', end_reason: 'ok', closed: true });

		finalize.mockClear();
		const failed = await stepShelterClose(
			couch.req,
			'SH001',
			{
				...initialShelterCloseStepState(),
				phase: 'finalize',
				counters: { checked_out: 0, cancelled: 0, households_repaired: 0, failed: 2 }
			},
			{ ...options, finalize }
		);
		expect(finalize).not.toHaveBeenCalled();
		expect(failed.outcome).toEqual({
			status: 'completed_with_errors',
			end_reason: 'failed',
			closed: false
		});
	});

	it('finalize in backfill mode always runs the injected finalize (FR-21)', async () => {
		const finalize = vi.fn(async () => ({ closed: false }));
		const res = await stepShelterClose(
			couch.req,
			'SH001',
			{
				...initialShelterCloseStepState(),
				phase: 'finalize',
				counters: { checked_out: 0, cancelled: 0, households_repaired: 0, failed: 1 }
			},
			{ ...options, mode: 'backfill', finalize }
		);
		expect(finalize).toHaveBeenCalledTimes(1);
		expect(res.outcome?.end_reason).toBe('failed');
	});

	it('finalize goes back to sweep when someone appeared after the re-count', async () => {
		addEvacuee('active');
		const res = await stepShelterClose(
			couch.req,
			'SH001',
			{ ...initialShelterCloseStepState(), phase: 'finalize' },
			options
		);
		expect(res.state.phase).toBe('sweep');
		expect(res.outcome).toBeNull();
	});

	it('sweep clears last round failures when it restarts people', async () => {
		addEvacuee('active');
		const res = await stepShelterClose(
			couch.req,
			'SH001',
			{
				...initialShelterCloseStepState(),
				phase: 'sweep',
				sweep_round: 1,
				counters: { checked_out: 4, cancelled: 0, households_repaired: 0, failed: 1 },
				failures: [{ evacuee_id: 'evacuee:X', error: 'e' }]
			},
			options
		);
		expect(res.state).toMatchObject({
			phase: 'people',
			sweep_round: 2,
			cursor: {},
			counters: { checked_out: 4, failed: 0 },
			failures: []
		});
	});
});

describe('dryRunShelterClose (FR-32)', () => {
	it('counts without writing anything', async () => {
		addEvacuee('active');
		addEvacuee('pre_registered');
		addEvacuee('checked_out');
		const before = couch.docs(SHELTER).map((d) => d._rev);
		const res = await dryRunShelterClose(couch.req, 'SH001');
		expect(res.preview).toEqual({ by_status: { active: 1, pre_registered: 1 }, total: 2 });
		expect(res.stale_households).toBe(0);
		expect(couch.log.every((l) => l.method === 'GET' || l.path.includes('_all_docs'))).toBe(true);
		expect(couch.docs(SHELTER).map((d) => d._rev)).toEqual(before);
		expect(couch.bulkLog).toHaveLength(0);
	});
});
