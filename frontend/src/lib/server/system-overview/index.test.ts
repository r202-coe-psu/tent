import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminRaw = vi.fn();
const listShelterMasters = vi.fn();

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: (...a: unknown[]) => adminRaw(...a),
	requireShelterScopeOrSA: vi.fn(),
	ServiceError: class extends Error {}
}));
vi.mock('$lib/server/shelters.admin', () => ({
	listShelterMasters: () => listShelterMasters(),
	migrate: (m: unknown) => m
}));
vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: () => 'http://fastapi',
	unwrapFastapiError: vi.fn()
}));
vi.mock('$lib/features/shelters/server', () => ({
	resolveOperationStatus: (m: { operation_status?: string }) => m.operation_status ?? 'active'
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
