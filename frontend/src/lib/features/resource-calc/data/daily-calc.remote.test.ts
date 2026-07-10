// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

// --- In-memory CouchDB stand-in (the impl talks to the low-level couch-db helpers) ---
const store = new Map<
	string,
	{ _id: string; _rev?: string; type?: string; [k: string]: unknown }
>();

function nextRev(rev?: string): string {
	const n = rev ? Number(rev.split('-')[0]) : 0;
	return `${n + 1}-x`;
}

const putDoc = vi.fn(async (_db: string, doc: { _id: string; _rev?: string }) => {
	const saved = { ...doc, _rev: nextRev(doc._rev) };
	store.set(doc._id, saved);
	return saved;
});

vi.mock('$lib/db/couch-db', () => ({
	getDoc: vi.fn(async (_db: string, id: string) => store.get(id) ?? null),
	putDoc: (db: string, doc: { _id: string; _rev?: string }) => putDoc(db, doc),
	couchDbFetch: vi.fn(async (_db: string, path: string) => {
		const url = new URL('http://x/' + path.replace(/^\//, ''));
		const startkey = JSON.parse(decodeURIComponent(url.searchParams.get('startkey')!));
		const endkey = JSON.parse(decodeURIComponent(url.searchParams.get('endkey')!));
		const rows = [...store.values()]
			.filter((d) => d._id >= startkey && d._id <= endkey)
			.map((d) => ({ id: d._id, doc: d }));
		return { rows };
	})
}));

// --- Peer barrels ---
const mockListEvacuees = vi.fn();
vi.mock('$lib/features/people', () => ({
	peopleRepository: () => ({ listEvacuees: mockListEvacuees })
}));

const mockGetBalance = vi.fn();
vi.mock('$lib/features/operations', () => ({
	operationsRepository: () => ({ getBalance: mockGetBalance })
}));

const mockGetActive = vi.fn();
vi.mock('$lib/features/sop-ratios', () => ({
	getActiveSopProfile: () => mockGetActive(),
	SOP_RATIO_KIND: {
		water_l_per_person_day: 'multiply',
		people_per_toilet_female: 'divide',
		max_queue_minutes: 'threshold'
	}
}));

import { DailyCalcRemoteRepository } from './daily-calc.remote';
import { FORMULA_V } from '../domain/calc.formula';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

function evacuee(status: string) {
	return { current_stay: { status } };
}

const activeProfile = {
	_id: 'sop_profile:abc',
	type: 'sop_profile',
	version: 3,
	ratios: {
		water_l_per_person_day: 15,
		people_per_toilet_female: 20,
		max_queue_minutes: 30
	}
};

function repo() {
	return new DailyCalcRemoteRepository('shelter_sh001');
}

beforeEach(() => {
	store.clear();
	putDoc.mockClear();
	mockListEvacuees.mockReset();
	mockGetBalance.mockReset();
	mockGetActive.mockReset();

	mockListEvacuees.mockResolvedValue([
		evacuee('active'),
		evacuee('active'),
		evacuee('checked_out'),
		evacuee('pre_registered')
	]);
	mockGetBalance.mockResolvedValue(new Map<string, number>([['water_l_per_person_day', 100]]));
	mockGetActive.mockResolvedValue(activeProfile);
});

describe('DailyCalcRemoteRepository.runOnDemand', () => {
	it('mints a deterministic, snapshot-locked daily_calc doc from the three barrel inputs', async () => {
		const rec = await repo().runOnDemand('2026-07-08', ctx);

		expect(rec._id).toBe('daily_calc:2026-07-08');
		expect(rec.type).toBe('daily_calc');
		expect(rec.shelter_code).toBe('SH001');
		expect(rec.occupancy_snapshot).toBe(2); // only active (present) counts
		expect(rec.sop_profile_version).toBe(3);
		expect(rec.formula_v).toBe(FORMULA_V);
		expect(rec.results).toHaveLength(3);

		const byKey = Object.fromEntries(rec.results.map((r) => [r.key, r]));
		// multiply: need = 2 × 15 = 30, have 100 → surplus
		expect(byKey.water_l_per_person_day.need).toBe(30);
		expect(byKey.water_l_per_person_day.status).toBe('surplus');
		// divide: need = ceil(2 / 20) = 1, no stock key → stock_unsynced
		expect(byKey.people_per_toilet_female.need).toBe(1);
		expect(byKey.people_per_toilet_female.data_status).toBe('stock_unsynced');
		// threshold: quality ceiling → constraint, no have
		expect(byKey.max_queue_minutes.status).toBe('constraint');
		expect(byKey.max_queue_minutes.have).toBeNull();
	});

	it('is idempotent — same date reuses daily_calc:{date}, never a second doc', async () => {
		await repo().runOnDemand('2026-07-08', ctx);
		await repo().runOnDemand('2026-07-08', ctx);
		const dailyDocs = [...store.values()].filter((d) => d.type === 'daily_calc');
		expect(dailyDocs).toHaveLength(1);
	});

	it('does NOT write an audit entry on the first (create) run', async () => {
		await repo().runOnDemand('2026-07-08', ctx);
		const audits = [...store.values()].filter((d) => d.type === 'audit');
		expect(audits).toHaveLength(0);
	});

	it('preserves the losing revision into audit:retro_edit BEFORE overwriting', async () => {
		const first = await repo().runOnDemand('2026-07-08', ctx);
		putDoc.mockClear();

		// occupancy changes → a genuine retroactive recalculation
		mockListEvacuees.mockResolvedValue([evacuee('active')]);
		await repo().runOnDemand('2026-07-08', ctx);

		// order: audit persisted first, THEN the daily_calc overwrite
		const order = putDoc.mock.calls.map((c) => (c[1] as unknown as { type: string }).type);
		expect(order).toEqual(['audit', 'daily_calc']);

		const audit = [...store.values()].find((d) => d.type === 'audit') as
			{ action: string; target_id: string; context: { overwritten_rev: string } } | undefined;
		expect(audit?.action).toBe('retro_edit');
		expect(audit?.target_id).toBe('daily_calc:2026-07-08');
		expect(audit?.context.overwritten_rev).toBe(first._rev);

		// the overwrite kept the id + created_at, produced a new revision and occupancy
		const overwritten = store.get('daily_calc:2026-07-08') as unknown as {
			_rev?: string;
			created_at: string;
			occupancy_snapshot: number;
		};
		expect(overwritten.occupancy_snapshot).toBe(1);
		expect(overwritten.created_at).toBe(first.created_at);
		expect(overwritten._rev).not.toBe(first._rev);
	});

	it('throws when there is no active SOP profile', async () => {
		mockGetActive.mockResolvedValue(null);
		await expect(repo().runOnDemand('2026-07-08', ctx)).rejects.toThrow('No active SOP profile');
	});
});

describe('DailyCalcRemoteRepository.get / listRange', () => {
	it('get returns null when the day has not been calculated', async () => {
		expect(await repo().get('2026-07-08')).toBeNull();
	});

	it('get returns the persisted snapshot', async () => {
		await repo().runOnDemand('2026-07-08', ctx);
		const got = await repo().get('2026-07-08');
		expect(got?._id).toBe('daily_calc:2026-07-08');
	});

	it('listRange returns only in-range snapshots, ascending by date', async () => {
		await repo().runOnDemand('2026-07-06', ctx);
		await repo().runOnDemand('2026-07-08', ctx);
		await repo().runOnDemand('2026-07-10', ctx);

		const range = await repo().listRange('2026-07-07', '2026-07-09');
		expect(range.map((r) => r._id)).toEqual(['daily_calc:2026-07-08']);

		const wide = await repo().listRange('2026-07-06', '2026-07-10');
		expect(wide.map((r) => r._id)).toEqual([
			'daily_calc:2026-07-06',
			'daily_calc:2026-07-08',
			'daily_calc:2026-07-10'
		]);
	});
});
