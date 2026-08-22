// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';

vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

/**
 * T-31.9 — the "memory adapter" for daily-calc repository tests: an in-memory CouchDB double.
 * `daily-calc.remote.ts` bypasses the generic `Repository`/`createInMemoryRepository` interface
 * (it talks to `$lib/db/couch-db`'s low-level `getDoc`/`putDoc`/`couchDbFetch` directly), so this
 * feature's memory adapter is this hand-rolled `Map`-backed double rather than the canonical one
 * used by `people`/`kitchen`/`operations` — a deliberate, scoped decision (see the T-31.9 plan),
 * not an oversight. Extracted into a named function purely for readability; behavior unchanged.
 */
function createFakeCouchDb() {
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

	const getDoc = vi.fn(async (_db: string, id: string) => store.get(id) ?? null);

	const couchDbFetch = vi.fn(async (_db: string, path: string) => {
		const url = new URL('http://x/' + path.replace(/^\//, ''));
		const startkey = JSON.parse(decodeURIComponent(url.searchParams.get('startkey')!));
		const endkey = JSON.parse(decodeURIComponent(url.searchParams.get('endkey')!));
		const rows = [...store.values()]
			.filter((d) => d._id >= startkey && d._id <= endkey)
			.map((d) => ({ id: d._id, doc: d }));
		return { rows };
	});

	return { store, getDoc, putDoc, couchDbFetch };
}

// --- In-memory CouchDB stand-in (the impl talks to the low-level couch-db helpers) ---
// vi.hoisted is required here (not a plain top-level const): vi.mock() factories are hoisted
// above normal module code, so anything they close over must be initialized via vi.hoisted to
// avoid a TDZ "Cannot access before initialization" error.
const { store, getDoc, putDoc, couchDbFetch } = vi.hoisted(() => createFakeCouchDb());

vi.mock('$lib/db/couch-db', () => ({
	getDoc,
	putDoc: (db: string, doc: { _id: string; _rev?: string }) => putDoc(db, doc),
	couchDbFetch
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
	getVerifiedActiveSopProfile: () => mockGetActive(),
	SOP_RATIO_KIND: {
		water_l_per_person_day: 'multiply',
		drinking_water_l_per_person_day: 'multiply',
		cooking_water_l_per_person_day: 'multiply',
		hygiene_water_l_per_person_day: 'multiply',
		kcal_per_adult_day: 'multiply',
		people_per_tap: 'divide',
		people_per_handpump: 'divide',
		people_per_open_well: 'divide',
		people_per_laundry: 'divide',
		people_per_bathing: 'divide',
		people_per_toilet_female: 'divide',
		people_per_toilet_male: 'divide',
		people_per_dining_point_adult: 'divide',
		people_per_dining_point_child: 'divide',
		m2_per_person_living: 'multiply',
		m2_per_person_living_cold: 'multiply',
		m2_per_person_total: 'multiply',
		max_waterpoint_distance_m: 'threshold',
		max_queue_minutes: 'threshold',
		people_per_volunteer: 'divide'
	}
}));

const mockGetShelter = vi.fn();
vi.mock('$lib/features/shelters', () => ({
	sheltersRepository: () => ({ getShelter: mockGetShelter })
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
		water_l_per_person_day: '15',
		drinking_water_l_per_person_day: '3',
		cooking_water_l_per_person_day: '6',
		hygiene_water_l_per_person_day: '6',
		kcal_per_adult_day: '2000',
		people_per_tap: '80',
		people_per_handpump: '500',
		people_per_open_well: '400',
		people_per_laundry: '100',
		people_per_bathing: '50',
		people_per_toilet_female: '20',
		people_per_toilet_male: '35',
		people_per_dining_point_adult: '20',
		people_per_dining_point_child: '10',
		m2_per_person_living: '3.5',
		m2_per_person_living_cold: '4.5',
		m2_per_person_total: '45',
		max_waterpoint_distance_m: '500',
		max_queue_minutes: '30',
		people_per_volunteer: '50'
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
	mockGetShelter.mockReset();

	mockListEvacuees.mockResolvedValue([
		evacuee('active'),
		evacuee('active'),
		evacuee('checked_out'),
		evacuee('pre_registered')
	]);
	mockGetBalance.mockResolvedValue(new Map<string, string>([['item:water', '100']]));
	mockGetActive.mockResolvedValue(activeProfile);
	mockGetShelter.mockResolvedValue({
		area_m2: 500,
		facilities: { water_points: 3, showers: 5, toilets_female: 10, toilets_male: 8 }
	});
});

describe('DailyCalcRemoteRepository.runOnDemand', () => {
	it('mints a deterministic, snapshot-locked daily_calc doc from the four barrel inputs', async () => {
		const rec = await repo().runOnDemand('2026-07-08', ctx);

		expect(rec._id).toBe('daily_calc:2026-07-08');
		expect(rec.type).toBe('daily_calc');
		expect(rec.shelter_code).toBe('SH001');
		expect(rec.occupancy_snapshot).toBe(2); // only active (present) counts
		expect(rec.sop_profile_version).toBe(3);
		expect(rec.ratio_source).toBe('master');
		expect(rec.sop_override_id).toBeNull();
		expect(rec.sop_override_version).toBeNull();
		expect(rec.formula_v).toBe(FORMULA_V);
		expect(rec.results).toHaveLength(20);

		const byKey = Object.fromEntries(rec.results.map((r) => [r.key, r]));
		// multiply: need = 2 × 15 = 30, have 100 → surplus
		expect(byKey.water_l_per_person_day.need).toBe('30');
		expect(byKey.water_l_per_person_day.status).toBe('surplus');
		// divide: need = ceil(2 / 20) = 1, mapped to shelter facilities
		expect(byKey.people_per_toilet_female.need).toBe('1');
		expect(byKey.people_per_toilet_female.have).toBe('10');
		// threshold: quality ceiling → constraint, no have
		expect(byKey.max_queue_minutes.status).toBe('constraint');
		expect(byKey.max_queue_minutes.have).toBeNull();
	});

	it('freezes the active override identity and leaves absent mapped sources null', async () => {
		mockGetActive.mockResolvedValue({
			...activeProfile,
			_id: 'sop_override:SH001:summer',
			type: 'sop_override',
			version: 4
		});
		mockGetShelter.mockResolvedValue({ area_m2: null, facilities: {} });

		const rec = await repo().runOnDemand('2026-07-08', ctx);

		expect(rec.ratio_source).toBe('override');
		expect(rec.sop_override_id).toBe('sop_override:SH001:summer');
		expect(rec.sop_override_version).toBe(4);
		const byKey = Object.fromEntries(rec.results.map((r) => [r.key, r]));
		expect(byKey.people_per_toilet_female.have).toBeNull();
		expect(rec.stock_snapshot.people_per_toilet_female).toBeNull();
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

	it('rejects a legacy record instead of silently migrating it during recalculation', async () => {
		const first = await repo().runOnDemand('2026-07-08', ctx);
		store.set(first._id, { ...first, schema_v: 1 });

		await expect(repo().runOnDemand('2026-07-08', ctx)).rejects.toMatchObject({
			kind: 'unsupported_schema',
			documentId: first._id
		});
		expect(putDoc).not.toHaveBeenCalledWith(
			'shelter_sh001',
			expect.objectContaining({ type: 'audit' })
		);
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

	it('get fails closed when the persisted snapshot uses an unsupported schema', async () => {
		const created = await repo().runOnDemand('2026-07-08', ctx);
		store.set(created._id, { ...created, schema_v: 1 });

		await expect(repo().get('2026-07-08')).rejects.toMatchObject({
			kind: 'unsupported_schema',
			documentId: created._id
		});
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

	it('listRange fails closed instead of silently dropping one malformed snapshot', async () => {
		const created = await repo().runOnDemand('2026-07-08', ctx);
		store.set(created._id, { ...created, schema_v: 1 });

		await expect(repo().listRange('2026-07-08', '2026-07-08')).rejects.toMatchObject({
			kind: 'unsupported_schema',
			documentId: created._id
		});
	});

	it('T-31 fails closed and does not write or overwrite daily_calc when master pointer integrity fails', async () => {
		const { SopMasterIntegrityError } = await import('$lib/utils/errors');
		mockGetActive.mockRejectedValueOnce(
			new SopMasterIntegrityError('pointer_missing', 'Active master pointer missing')
		);

		putDoc.mockClear();
		await expect(repo().runOnDemand('2026-08-19', ctx)).rejects.toBeInstanceOf(
			SopMasterIntegrityError
		);

		// Verified that putDoc was never called to create or overwrite daily_calc snapshot
		expect(putDoc).not.toHaveBeenCalled();
		expect(store.has('daily_calc:2026-08-19')).toBe(false);
	});
});
