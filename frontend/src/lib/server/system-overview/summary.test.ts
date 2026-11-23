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
	resolveOperationStatus: (m: { operation_status?: string }) => m.operation_status ?? 'active'
}));

import { buildOverviewSummary } from './index';

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
		expect(Object.values(out.sites_by_site_kind).reduce((a, b) => a + b, 0)).toBe(out.sites_total);
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
