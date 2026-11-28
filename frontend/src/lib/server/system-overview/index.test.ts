import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminRaw = vi.fn();
const listShelterMasters = vi.fn();

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: (...a: unknown[]) => adminRaw(...a),
	requireShelterScopeOrSA: vi.fn(),
	ServiceError: class extends Error {}
}));
vi.mock('$lib/server/shelters.admin', () => ({
	listShelterMasters: (...a: unknown[]) => listShelterMasters(...a),
	migrate: (m: unknown) => m
}));
vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: () => 'http://fastapi',
	unwrapFastapiError: vi.fn()
}));
vi.mock('$lib/features/shelters/server', () => ({
	resolveOperationStatus: (m: { operation_status?: string }) => m.operation_status ?? 'active',
	isExternalShelter: (m: { is_external?: boolean }) => m.is_external === true
}));

import {
	buildOverviewDemographics,
	buildOverviewOrigin,
	buildOverviewSites,
	buildPreRegistrationsList,
	clearOverviewViewCache
} from './index';

const master = (code: string, capacity: number) => ({
	code,
	name: `Shelter ${code}`,
	site_kind: 'evacuation_center',
	operation_status: 'active',
	capacity
});

const filters = (over: Record<string, unknown> = {}) =>
	({
		movement_window: 'today',
		stay_bucket: 'all',
		source: 'all',
		limit: 50,
		offset: 0,
		...over
	}) as never;

function route(table: Record<string, (path: string, body?: unknown) => unknown>) {
	adminRaw.mockImplementation(async (path: string, _m: string, body?: unknown) => {
		for (const [needle, fn] of Object.entries(table)) {
			if (path.includes(needle)) return { status: 200, data: fn(path, body) };
		}
		return { status: 404, data: null };
	});
}

beforeEach(() => {
	adminRaw.mockReset();
	listShelterMasters.mockReset();
	clearOverviewViewCache();
});

describe('buildOverviewSites paging (#1502)', () => {
	it('reads movements only for the requested page and reports the total', async () => {
		listShelterMasters.mockResolvedValue([master('A', 10), master('B', 10), master('C', 10)]);
		route({
			'/_view/occupancy': (p) => ({
				rows: [
					{ key: 'active', value: p.includes('shelter_a/') ? 9 : p.includes('shelter_b/') ? 5 : 1 }
				]
			}),
			registrations_by_date_status: () => ({ rows: [] })
		});
		const out = await buildOverviewSites(filters({ limit: 2, offset: 0 }));
		expect(out.total).toBe(3);
		expect(out.sites.map((s) => s.shelter_code)).toEqual(['A', 'B']);
		const movementCalls = adminRaw.mock.calls.filter(([p]) =>
			String(p).includes('registrations_by_date_status')
		);
		expect(movementCalls).toHaveLength(2);

		const page2 = await buildOverviewSites(filters({ limit: 2, offset: 2 }));
		expect(page2.sites.map((s) => s.shelter_code)).toEqual(['C']);
		expect(page2.total).toBe(3);
	});
});

describe('buildOverviewSites ordering (#1502 review)', () => {
	it('breaks forecast_pct ties by shelter_code regardless of registry order', async () => {
		route({
			'/_view/occupancy': () => ({ rows: [] }),
			registrations_by_date_status: () => ({ rows: [] })
		});
		for (const order of [
			['C', 'A', 'B'],
			['B', 'C', 'A']
		]) {
			listShelterMasters.mockResolvedValue(order.map((c) => master(c, 10)));
			clearOverviewViewCache();
			const p1 = await buildOverviewSites(filters({ limit: 2, offset: 0 }));
			const p2 = await buildOverviewSites(filters({ limit: 2, offset: 2 }));
			expect([...p1.sites, ...p2.sites].map((s) => s.shelter_code)).toEqual(['A', 'B', 'C']);
		}
	});
});

describe('failed reads are not memoised and offsets are clamped (#1502 review)', () => {
	it('retries a failed occupancy read instead of caching the empty result', async () => {
		listShelterMasters.mockResolvedValue([master('A', 10)]);
		let calls = 0;
		adminRaw.mockImplementation(async (path: string) => {
			if (path.includes('/_view/occupancy')) {
				calls += 1;
				return calls === 1
					? { status: 503, data: null }
					: { status: 200, data: { rows: [{ key: 'active', value: 4 }] } };
			}
			return { status: 200, data: { rows: [] } };
		});
		const first = await buildOverviewSites(filters());
		expect(first.sites[0].present).toBe(0);
		const second = await buildOverviewSites(filters());
		expect(second.sites[0].present).toBe(4);
	});

	it('snaps an out-of-range offset to the last page', async () => {
		listShelterMasters.mockResolvedValue([master('A', 10), master('B', 10), master('C', 10)]);
		route({
			'/_view/occupancy': () => ({ rows: [{ key: 'active', value: 1 }] }),
			registrations_by_date_status: () => ({ rows: [] })
		});
		const out = await buildOverviewSites(filters({ limit: 2, offset: 40 }));
		expect(out.offset).toBe(2);
		expect(out.sites).toHaveLength(1);
	});
});

describe('buildOverviewOrigin (#1502)', () => {
	it('fetches households in one batched call, not one GET per evacuee', async () => {
		listShelterMasters.mockResolvedValue([master('A', 10)]);
		route({
			'/_view/occupancy': () => ({ rows: [] }),
			'/_find': () => ({
				docs: [
					{ _id: 'evacuee:1', type: 'evacuee', household_id: 'household:1' },
					{ _id: 'evacuee:2', type: 'evacuee', household_id: 'household:1' },
					{ _id: 'evacuee:3', type: 'evacuee', household_id: 'household:2' }
				]
			}),
			'/_all_docs': () => ({
				rows: [
					{ doc: { _id: 'household:1', province: 'สงขลา' } },
					{ doc: { _id: 'household:2', province: 'ยะลา' } }
				]
			})
		});
		const out = await buildOverviewOrigin(filters({ source: 'bound' }), fetch, null);
		expect(out.buckets.find((b) => b.province === 'สงขลา')?.count).toBe(2);
		expect(out.buckets.find((b) => b.province === 'ยะลา')?.count).toBe(1);
		const allDocs = adminRaw.mock.calls.filter(([p]) => String(p).includes('/_all_docs'));
		expect(allDocs).toHaveLength(1);
		expect(allDocs[0][2]).toEqual({ keys: ['household:1', 'household:2'] });
		expect(adminRaw.mock.calls.some(([p]) => String(p).includes('/household%3A'))).toBe(false);
	});
});

describe('buildOverviewDemographics (#1502)', () => {
	it('cross-tabs from the reduced view with no _find', async () => {
		listShelterMasters.mockResolvedValue([master('A', 10)]);
		route({
			'/_view/occupancy': () => ({ rows: [] }),
			demographics_by_country_age: () => ({
				rows: [
					{ key: ['TH', 1990], value: 3 },
					{ key: ['MM', null], value: 2 }
				]
			})
		});
		const out = await buildOverviewDemographics(filters());
		expect(out.countries).toEqual({ TH: 3, MM: 2 });
		expect(adminRaw.mock.calls.some(([p]) => String(p).includes('/_find'))).toBe(false);
	});

	it('falls back to the per-axis views when the shelter is on a stale manifest', async () => {
		listShelterMasters.mockResolvedValue([master('A', 10)]);
		// demographics_by_country_age is absent (404) -> legacy views are used.
		const ok = (rows: unknown[]) => ({ status: 200, data: { rows } });
		adminRaw.mockImplementation(async (path: string) => {
			if (path.includes('demographics_by_country_age')) return { status: 404, data: null };
			if (path.includes('demographics_by_age'))
				return ok([
					{ key: 1990, value: 3 },
					{ key: null, value: 2 }
				]);
			if (path.includes('demographics_by_country'))
				return ok([
					{ key: 'TH', value: 3 },
					{ key: 'MM', value: 2 }
				]);
			return ok([]);
		});
		const out = await buildOverviewDemographics(filters());
		expect(out.countries).toEqual({ TH: 3, MM: 2 });
		expect(Object.values(out.age_groups).reduce((a, b) => a + b, 0)).toBe(5);
		expect(out.age_by_country).toEqual({});
	});
});

describe('buildPreRegistrationsList paging (#1502)', () => {
	const unassignedFetch = (async () =>
		new Response(
			JSON.stringify({ items: [], total: 0, open_member_count: 0, limit: 200, offset: 0 }),
			{
				status: 200
			}
		)) as unknown as typeof fetch;

	it('pages at the DB via prereg_by_created and merges across shelters', async () => {
		listShelterMasters.mockResolvedValue([master('A', 10), master('B', 10)]);
		const doc = (id: string, at: string) => ({
			_id: id,
			type: 'evacuee',
			first_name: id,
			created_at: at,
			current_stay: { status: 'pre_registered' }
		});
		route({
			'prereg_by_created?reduce=false': (p) => ({
				rows: p.includes('shelter_a/')
					? [{ doc: doc('a2', '2026-01-04') }, { doc: doc('a1', '2026-01-01') }]
					: [{ doc: doc('b1', '2026-01-03') }]
			}),
			'/_view/prereg_by_created': (p) => ({ rows: [{ value: p.includes('shelter_a/') ? 40 : 25 }] })
		});
		const out = await buildPreRegistrationsList(filters({ limit: 2 }), unassignedFetch, null);
		expect(out.total).toBe(65);
		expect(out.items.map((i) => i.evacuee_id)).toEqual(['a2', 'b1']);
		const pageCalls = adminRaw.mock.calls.filter(([p]) => String(p).includes('reduce=false'));
		expect(pageCalls.every(([p]) => String(p).includes('limit=2'))).toBe(true);
		expect(adminRaw.mock.calls.some(([p]) => String(p).includes('/_find'))).toBe(false);
	});

	it('snaps an out-of-range offset to the last page (fast path)', async () => {
		listShelterMasters.mockResolvedValue([master('A', 10)]);
		const doc = (id: string, at: string) => ({
			_id: id,
			type: 'evacuee',
			created_at: at,
			current_stay: { status: 'pre_registered' }
		});
		route({
			'prereg_by_created?reduce=false': () => ({
				rows: [
					{ doc: doc('e3', '2026-01-03') },
					{ doc: doc('e2', '2026-01-02') },
					{ doc: doc('e1', '2026-01-01') }
				]
			}),
			'/_view/prereg_by_created': () => ({ rows: [{ value: 3 }] })
		});
		const out = await buildPreRegistrationsList(
			filters({ limit: 2, offset: 40 }),
			unassignedFetch,
			null
		);
		expect(out.total).toBe(3);
		expect(out.offset).toBe(2);
		expect(out.items.map((i) => i.evacuee_id)).toEqual(['e1']);
	});

	it('falls back to the full scan when a shelter lacks the view', async () => {
		listShelterMasters.mockResolvedValue([master('A', 10)]);
		route({
			'/_find': (_p, body) =>
				(body as { selector: { type: string } }).selector.type === 'household'
					? { docs: [] }
					: {
							docs: [
								{
									_id: 'e1',
									type: 'evacuee',
									created_at: '2026-01-01',
									current_stay: { status: 'pre_registered' }
								}
							]
						}
		});
		const out = await buildPreRegistrationsList(filters(), unassignedFetch, null);
		expect(out.total).toBe(1);
		expect(out.items[0].evacuee_id).toBe('e1');
	});
});

describe('buildOverviewSites — hidden shelters (#1515)', () => {
	const seed = () => {
		const all: (ReturnType<typeof master> & { feature_flags?: { public_visible: boolean } })[] = [
			master('A', 10),
			{ ...master('B', 10), feature_flags: { public_visible: false } },
			{ ...master('C', 10), feature_flags: { public_visible: true } }
		];
		// Stands in for the CouchDB-side filter in listShelterMasters.
		listShelterMasters.mockImplementation(
			async (opts: { publicVisibility?: 'visible' | 'hidden' } = {}) =>
				all.filter((m) => {
					const hidden = m.feature_flags?.public_visible === false;
					if (opts.publicVisibility === 'hidden') return hidden;
					if (opts.publicVisibility === 'visible') return !hidden;
					return true;
				})
		);
		route({
			'/_view/occupancy': () => ({ rows: [] }),
			registrations_by_date_status: () => ({ rows: [] })
		});
	};

	it('flags a shelter whose public_visible flag is false, and treats a missing flag as visible', async () => {
		seed();
		const out = await buildOverviewSites(filters());
		const visibility = Object.fromEntries(out.sites.map((s) => [s.shelter_code, s.public_visible]));
		expect(visibility).toEqual({ A: true, B: false, C: true });
		expect(out.hidden_total).toBe(1);
	});

	it('counts hidden shelters across all pages, not just the one returned', async () => {
		seed();
		const out = await buildOverviewSites(filters({ limit: 1, offset: 0 }));
		expect(out.sites).toHaveLength(1);
		expect(out.total).toBe(3);
		expect(out.hidden_total).toBe(1);
	});

	it('keeps only the hidden shelters when asked for them', async () => {
		seed();
		const out = await buildOverviewSites(filters({ public_visibility: 'hidden' }));
		expect(listShelterMasters).toHaveBeenCalledWith({ publicVisibility: 'hidden' });
		expect(out.sites.map((s) => s.shelter_code)).toEqual(['B']);
	});

	it('keeps only the shelters shown on public when asked for them', async () => {
		seed();
		const out = await buildOverviewSites(filters({ public_visibility: 'visible' }));
		expect(listShelterMasters).toHaveBeenCalledWith({ publicVisibility: 'visible' });
		expect(out.sites.map((s) => s.shelter_code).sort()).toEqual(['A', 'C']);
		expect(out.hidden_total).toBe(0);
	});
});

describe('buildOverviewOrigin — source shelter (#1515)', () => {
	const unassignedFetch = (items: unknown[]) =>
		vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ items })
		})) as unknown as typeof fetch;

	it('names the shelter each bound row comes from and keeps the grand total', async () => {
		listShelterMasters.mockResolvedValue([master('A', 10), master('B', 10)]);
		route({
			'/_view/occupancy': () => ({ rows: [] }),
			'/_find': () => ({
				docs: [
					{ _id: 'evacuee:1', type: 'evacuee', household_id: 'household:1' },
					{ _id: 'evacuee:2', type: 'evacuee', household_id: 'household:1' }
				]
			}),
			'/_all_docs': () => ({ rows: [{ doc: { _id: 'household:1', province: 'ปัตตานี' } }] })
		});
		const { buckets } = await buildOverviewOrigin(filters({ source: 'bound' }), fetch, null);
		expect(buckets.map((b) => b.shelter_code).sort()).toEqual(['A', 'B']);
		expect(buckets.every((b) => b.count === 2)).toBe(true);
	});

	it('lists registrants that have not chosen a shelter with no shelter code', async () => {
		const fetchFn = unassignedFetch([
			{
				household: { province: 'ยะลา', district: 'เมือง', subdistrict: 'สะเตง' },
				open_member_count: 3
			}
		]);
		const { buckets } = await buildOverviewOrigin(filters({ source: 'unassigned' }), fetchFn, null);
		expect(buckets).toEqual([
			{ province: 'ยะลา', district: 'เมือง', subdistrict: 'สะเตง', shelter_code: null, count: 3 }
		]);
	});

	it('leaves the unassigned queue out when filtering by public visibility', async () => {
		const fetchFn = unassignedFetch([{ household: { province: 'ยะลา' }, open_member_count: 3 }]);
		const { buckets } = await buildOverviewOrigin(
			filters({ source: 'unassigned', public_visibility: 'hidden' }),
			fetchFn,
			null
		);
		expect(buckets).toEqual([]);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('returns one page of rows and the total across all pages', async () => {
		const fetchFn = unassignedFetch(
			['ก', 'ข', 'ค'].map((province, i) => ({ household: { province }, open_member_count: i + 1 }))
		);
		const out = await buildOverviewOrigin(
			filters({ source: 'unassigned', limit: 2, offset: 2 }),
			fetchFn,
			null
		);
		expect(out.total).toBe(3);
		expect(out.offset).toBe(2);
		// Largest count first: ค(3), ข(2), ก(1) — page 2 holds the last one.
		expect(out.buckets.map((b) => b.province)).toEqual(['ก']);
	});
});
