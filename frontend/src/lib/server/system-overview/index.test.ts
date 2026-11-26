import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminRaw, listShelterMasters } = vi.hoisted(() => ({
	adminRaw: vi.fn(),
	listShelterMasters: vi.fn()
}));

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw,
	requireShelterScopeOrSA: vi.fn(),
	ServiceError: class ServiceError extends Error {}
}));
vi.mock('$lib/server/shelters.admin', () => ({
	listShelterMasters,
	migrate: (master: unknown) => master
}));
vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: () => 'http://fastapi.test',
	unwrapFastapiError: (error: unknown) => error
}));

import { parseOverviewFilters } from '$lib/features/system-overview/domain';
import { buildOverviewOrigin, buildOverviewSites } from './index';

const master = (code: string, flags?: Record<string, unknown>) => ({
	code,
	name: `ศูนย์ ${code}`,
	site_kind: 'evacuation_center',
	capacity: 100,
	province: 'สงขลา',
	district: 'หาดใหญ่',
	subdistrict: 'คอหงส์',
	operation_status: 'active',
	...(flags ? { feature_flags: flags } : {})
});

const filtersOf = (query: string) => parseOverviewFilters(new URLSearchParams(query));

beforeEach(() => {
	vi.clearAllMocks();
	listShelterMasters.mockResolvedValue([
		master('SH001'),
		master('SH002', { public_visible: false }),
		master('SH003', { public_visible: true })
	]);
	adminRaw.mockImplementation(async (path: string, method: string) => {
		if (path.includes('/_find') && method === 'POST') {
			// Two pre-registered evacuees per shelter, each in a household of its own province.
			return {
				status: 200,
				data: {
					docs: [
						{ _id: 'evacuee:a', type: 'evacuee', household_id: 'household:x' },
						{ _id: 'evacuee:b', type: 'evacuee', household_id: 'household:x' }
					]
				}
			};
		}
		if (path.includes('/household%3Ax')) {
			return {
				status: 200,
				data: { _id: 'household:x', type: 'household', province: 'ปัตตานี' }
			};
		}
		return { status: 200, data: { rows: [] } };
	});
});

describe('buildOverviewSites — hidden shelters (#1515)', () => {
	it('flags a shelter whose public_visible flag is false, and treats a missing flag as visible', async () => {
		const { sites } = await buildOverviewSites(filtersOf(''));

		const visibility = Object.fromEntries(sites.map((s) => [s.shelter_code, s.public_visible]));
		expect(visibility).toEqual({ SH001: true, SH002: false, SH003: true });
	});

	it('keeps only the hidden shelters when asked for them', async () => {
		const { sites } = await buildOverviewSites(filtersOf('public_visibility=hidden'));

		expect(sites.map((s) => s.shelter_code)).toEqual(['SH002']);
	});

	it('keeps only the shelters shown on public when asked for them', async () => {
		const { sites } = await buildOverviewSites(filtersOf('public_visibility=visible'));

		expect(sites.map((s) => s.shelter_code).sort()).toEqual(['SH001', 'SH003']);
	});
});

describe('buildOverviewOrigin — source shelter (#1515)', () => {
	it('names the shelter each bound row comes from and keeps the grand total', async () => {
		const { buckets } = await buildOverviewOrigin(filtersOf('source=bound'), fetch, null);

		expect(buckets.map((b) => b.shelter_code).sort()).toEqual(['SH001', 'SH002', 'SH003']);
		expect(buckets.every((b) => b.count === 2)).toBe(true);
		expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(6);
	});

	it('lists registrants that are not bound yet with no shelter code', async () => {
		const unassigned = {
			items: [
				{
					household: { province: 'ยะลา', district: 'เมือง', subdistrict: 'สะเตง' },
					open_member_count: 3
				}
			]
		};
		const fetchFn = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => unassigned
		})) as unknown as typeof fetch;

		const { buckets } = await buildOverviewOrigin(filtersOf('source=unassigned'), fetchFn, null);

		expect(buckets).toEqual([
			{
				province: 'ยะลา',
				district: 'เมือง',
				subdistrict: 'สะเตง',
				shelter_code: null,
				count: 3
			}
		]);
	});

	it('leaves the unassigned queue out when filtering by public visibility', async () => {
		const fetchFn = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				items: [{ household: { province: 'ยะลา' }, open_member_count: 3 }]
			})
		})) as unknown as typeof fetch;

		const { buckets } = await buildOverviewOrigin(
			filtersOf('source=unassigned&public_visibility=hidden'),
			fetchFn,
			null
		);

		expect(buckets).toEqual([]);
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
