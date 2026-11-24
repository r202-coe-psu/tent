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
	// Mirrors CR-067: pre-migration masters get evacuation_center.
	migrate: (m: { site_kind?: string }) => ({ ...m, site_kind: m.site_kind ?? 'evacuation_center' })
}));
vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: () => 'http://fastapi',
	unwrapFastapiError: vi.fn()
}));
vi.mock('$lib/features/shelters/server', () => ({
	resolveOperationStatus: (m: { operation_status?: string }) => m.operation_status ?? null,
	isExternalShelter: (m: { is_external?: boolean }) => m.is_external === true
}));

import { buildOverviewSites, buildOverviewSummary } from './index';

const occupancy = (rows: Record<string, number>) => ({
	status: 200,
	data: { rows: Object.entries(rows).map(([key, value]) => ({ key, value })) }
});

const fetchStats = (async () =>
	new Response(JSON.stringify({ open_registrations: 0, open_members: 0 }), {
		status: 200
	})) as unknown as typeof fetch;

beforeEach(() => {
	adminRaw.mockReset();
	adminRaw.mockResolvedValue({ status: 200, data: { rows: [] } });
	listShelterMasters.mockReset();
});

describe('buildOverviewSummary sites_by_site_kind', () => {
	it('counts every status per kind, defaults a missing kind, and sums to sites_total', async () => {
		listShelterMasters.mockResolvedValue([
			{ code: 'A', name: 'A', site_kind: 'evacuation_center', operation_status: 'active' },
			{ code: 'B', name: 'B', site_kind: 'host_house', operation_status: 'closed' },
			{ code: 'C', name: 'C', site_kind: 'host_house', operation_status: 'cancelled' },
			{ code: 'D', name: 'D', operation_status: 'active' }
		]);
		const out = await buildOverviewSummary(
			{
				movement_window: 'today',
				stay_bucket: 'all',
				source: 'all',
				limit: 50,
				offset: 0
			} as never,
			fetchStats,
			null
		);
		expect(out.sites_by_site_kind).toEqual({ evacuation_center: 2, host_house: 2 });
		expect(out.sites_external).toBe(0);
		expect(Object.values(out.sites_by_site_kind).reduce((a, b) => a + b, 0)).toBe(out.sites_total);
	});

	it('counts external shelters only in sites_external, not inside a kind', async () => {
		listShelterMasters.mockResolvedValue([
			{ code: 'A', name: 'A', site_kind: 'evacuation_center' },
			{ code: 'B', name: 'B', site_kind: 'evacuation_center', is_external: true },
			{ code: 'C', name: 'C', site_kind: 'host_house', is_external: true }
		]);
		const out = await buildOverviewSummary(
			{
				movement_window: 'today',
				stay_bucket: 'all',
				source: 'all',
				limit: 50,
				offset: 0
			} as never,
			fetchStats,
			null
		);
		expect(out.sites_by_site_kind).toEqual({ evacuation_center: 1 });
		expect(out.sites_external).toBe(2);
		expect(
			Object.values(out.sites_by_site_kind).reduce((a, b) => a + b, 0) + out.sites_external
		).toBe(out.sites_total);
	});

	it('follows the same filters as sites_total', async () => {
		listShelterMasters.mockResolvedValue([
			{ code: 'A', name: 'A', site_kind: 'evacuation_center', province: 'x' },
			{ code: 'B', name: 'B', site_kind: 'host_house', province: 'y' }
		]);
		const out = await buildOverviewSummary(
			{
				movement_window: 'today',
				stay_bucket: 'all',
				source: 'all',
				limit: 50,
				offset: 0,
				shelter_province: 'y'
			} as never,
			fetchStats,
			null
		);
		expect(out.sites_by_site_kind).toEqual({ host_house: 1 });
		expect(out.sites_total).toBe(1);
	});
});

describe('buildOverviewSites is_external', () => {
	it('flags external shelters on the row', async () => {
		listShelterMasters.mockResolvedValue([
			{ code: 'A', name: 'A', site_kind: 'evacuation_center' },
			{ code: 'B', name: 'B', site_kind: 'evacuation_center', is_external: true }
		]);
		const out = await buildOverviewSites({
			movement_window: 'today',
			stay_bucket: 'all',
			source: 'all',
			limit: 50,
			offset: 0
		} as never);
		expect(Object.fromEntries(out.sites.map((r) => [r.shelter_code, r.is_external]))).toEqual({
			A: false,
			B: true
		});
	});
});

describe('operation_status filter', () => {
	it("matches shelters without a status when filtering by 'unknown'", async () => {
		listShelterMasters.mockResolvedValue([
			{ code: 'A', name: 'A', site_kind: 'evacuation_center', operation_status: 'active' },
			{ code: 'B', name: 'B', site_kind: 'evacuation_center' },
			{ code: 'C', name: 'C', site_kind: 'evacuation_center', operation_status: 'unknown' }
		]);
		const out = await buildOverviewSummary(
			{
				movement_window: 'today',
				stay_bucket: 'all',
				source: 'all',
				limit: 50,
				offset: 0,
				operation_status: 'unknown'
			} as never,
			fetchStats,
			null
		);
		expect(out.sites_total).toBe(2);
	});
});

describe('external filter', () => {
	it("keeps only external shelters when external = 'only'", async () => {
		listShelterMasters.mockResolvedValue([
			{ code: 'A', name: 'A', site_kind: 'evacuation_center' },
			{ code: 'B', name: 'B', site_kind: 'evacuation_center', is_external: true },
			{ code: 'C', name: 'C', site_kind: 'host_house', is_external: true }
		]);
		const out = await buildOverviewSummary(
			{
				movement_window: 'today',
				stay_bucket: 'all',
				source: 'all',
				limit: 50,
				offset: 0,
				external: 'only'
			} as never,
			fetchStats,
			null
		);
		expect(out.sites_total).toBe(2);
		expect(out.sites_external).toBe(2);
	});
});

describe('site_kind filter vs external shelters', () => {
	it('excludes external shelters when a regular kind is chosen', async () => {
		listShelterMasters.mockResolvedValue([
			{ code: 'A', name: 'A', site_kind: 'evacuation_center' },
			{ code: 'B', name: 'B', site_kind: 'evacuation_center', is_external: true }
		]);
		const out = await buildOverviewSummary(
			{
				movement_window: 'today',
				stay_bucket: 'all',
				source: 'all',
				limit: 50,
				offset: 0,
				site_kind: 'evacuation_center'
			} as never,
			fetchStats,
			null
		);
		expect(out.sites_total).toBe(1);
		expect(out.sites_by_site_kind).toEqual({ evacuation_center: 1 });
		expect(out.sites_external).toBe(0);
	});
});

describe('in-shelter totals skip closed, cancelled and external shelters', () => {
	it('counts present / forecast / capacity only for open, non-external shelters', async () => {
		listShelterMasters.mockResolvedValue([
			{
				code: 'A',
				name: 'A',
				site_kind: 'evacuation_center',
				operation_status: 'active',
				capacity: 100
			},
			{
				code: 'B',
				name: 'B',
				site_kind: 'evacuation_center',
				operation_status: 'closed',
				capacity: 100
			},
			{
				code: 'C',
				name: 'C',
				site_kind: 'evacuation_center',
				operation_status: 'cancelled',
				capacity: 100
			},
			{
				code: 'D',
				name: 'D',
				site_kind: 'evacuation_center',
				operation_status: 'active',
				capacity: 100,
				is_external: true
			}
		]);
		adminRaw.mockImplementation(async (path: string) =>
			path.includes('/_view/occupancy')
				? occupancy({ active: 10, pre_registered: 5 })
				: { status: 200, data: { rows: [] } }
		);
		const out = await buildOverviewSummary(
			{
				movement_window: 'today',
				stay_bucket: 'all',
				source: 'all',
				limit: 50,
				offset: 0
			} as never,
			fetchStats,
			null
		);
		expect(out.present_total).toBe(10);
		expect(out.forecast_total).toBe(15);
		expect(out.avg_present_pct).toBe(10);
		expect(out.avg_forecast_pct).toBe(15);
		expect(out.sites_total).toBe(4);
	});
});
