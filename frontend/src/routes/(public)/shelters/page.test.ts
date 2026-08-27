import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load } from './+page';
import type { PublicShelterCardModel } from '$lib/features/public-portal';

vi.mock('$lib/features/public-portal', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/features/public-portal')>();
	return {
		...actual,
		listPublicShelters: vi.fn()
	};
});

import { listPublicShelters, type PublicShelterListResponse } from '$lib/features/public-portal';

/**
 * `load` is typed against SvelteKit's full `LoadEvent`, but this page reads only
 * `url` and `fetch`. Building the rest of the event would test SvelteKit, not the
 * page — so the narrowing lives here once, described, rather than as a pair of
 * bare `as any` at each of the five call sites.
 */
async function runLoad(url: URL) {
	const result = await load({ url, fetch: vi.fn() } as unknown as Parameters<typeof load>[0]);
	// `PageLoad` is allowed to return nothing; this one always returns data, and
	// narrowing here is what lets each assertion below read a real property.
	if (!result) throw new Error('load() returned no data');
	return result;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type LoadEventInput = Parameters<typeof load>[0];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type LoadResult = {
	shelters: PublicShelterCardModel[];
	count: number;
	as_of: string;
	summary: {
		shelters_total: number;
		shelters_open: number;
	};
	filters: Record<string, string>;
	available_types: string[];
};

describe('public/shelters load function', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns empty shelters list gracefully when listPublicShelters throws an error', async () => {
		vi.mocked(listPublicShelters).mockRejectedValue(
			new Error('Network error / Service unavailable')
		);

		const url = new URL('http://localhost/shelters');
		const result = await runLoad(url);

		expect(result).toBeDefined();
		expect(result.shelters).toEqual([]);
		expect(result.count).toBe(0);
		expect(result.summary.shelters_total).toBe(0);
		expect(result.summary.shelters_open).toBe(0);
	});

	it('handles empty shelters array correctly', async () => {
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [],
			count: 0,
			as_of: '2026-08-19T10:00:00Z'
		});

		const url = new URL('http://localhost/shelters');
		const result = await runLoad(url);

		expect(result.shelters).toEqual([]);
		expect(result.count).toBe(0);
		expect(result.summary.shelters_total).toBe(0);
		expect(result.summary.shelters_open).toBe(0);
		expect(result.as_of).toBe('2026-08-19T10:00:00Z');
	});

	it('handles null or undefined shelters property safely', async () => {
		// Deliberately malformed: the point of the test is that a payload missing
		// `shelters` does not blow up the load, so it cannot satisfy the response type.
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: undefined,
			count: 0,
			as_of: '2026-08-19T10:00:00Z'
		} as unknown as PublicShelterListResponse);

		const url = new URL('http://localhost/shelters');
		const result = await runLoad(url);

		expect(result.shelters).toEqual([]);
		expect(result.count).toBe(0);
		expect(result.summary.shelters_total).toBe(0);
		expect(result.summary.shelters_open).toBe(0);
	});

	it('maps valid shelter items with safe property handling', async () => {
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [
				{
					code: 'SH001',
					name: 'ศูนย์ช่วยเหลือเทศบาล',
					status: 'open',
					capacity: 150,
					geo: { lat: 7.008, lng: 100.476 },
					province: 'สงขลา',
					district: 'หาดใหญ่',
					subdistrict: 'หาดใหญ่',
					updated_at: '2026-08-19T00:00:00Z'
				},
				{
					code: 'SH002',
					name: 'ศูนย์พักพิงโรงเรียน',
					status: 'closed',
					capacity: 80,
					geo: null,
					province: 'สงขลา',
					district: 'หาดใหญ่',
					subdistrict: 'คอหงส์',
					updated_at: '2026-08-19T00:00:00Z'
				}
			],
			count: 2,
			as_of: '2026-08-19T10:00:00Z'
		});

		const url = new URL('http://localhost/shelters');
		const result = await runLoad(url);

		expect(result.shelters).toHaveLength(2);
		expect(result.count).toBe(2);
		expect(result.summary.shelters_total).toBe(2);
		expect(result.summary.shelters_open).toBe(1);
		expect(result.shelters[0].name).toBe('ศูนย์ช่วยเหลือเทศบาล');
		expect(result.shelters[0].status).toBe('OPEN');
		expect(result.shelters[1].status).toBe('CLOSED');
	});

	it('filters by search keyword safely even if fields are partially missing', async () => {
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [
				{
					code: 'SH001',
					name: 'ศูนย์หาดใหญ่',
					status: 'open',
					capacity: 100,
					province: 'สงขลา',
					district: 'หาดใหญ่',
					updated_at: '2026-08-19T00:00:00Z'
				},
				{
					code: 'SH002',
					name: 'ศูนย์เมือง',
					status: 'open',
					capacity: 50,
					province: 'ยะลา',
					district: 'เมืองยะลา',
					updated_at: '2026-08-19T00:00:00Z'
				}
			],
			count: 2,
			as_of: '2026-08-19T10:00:00Z'
		});

		const url = new URL('http://localhost/shelters?q=หาดใหญ่');
		const result = await runLoad(url);

		expect(result.shelters).toHaveLength(1);
		expect(result.shelters[0].code).toBe('SH001');
	});
});
