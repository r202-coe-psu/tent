import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load } from './+page';

vi.mock('$lib/features/public-portal', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/features/public-portal')>();
	return {
		...actual,
		listPublicShelters: vi.fn(),
		fetchShelterTypes: vi.fn().mockResolvedValue([])
	};
});

import {
	listPublicShelters,
	fetchShelterTypes,
	type PublicShelterListResponse,
	type PublicShelterCardModel
} from '$lib/features/public-portal';

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

/**
 * `load` is typed against SvelteKit's full `LoadEvent`, but this page reads only
 * `url` and `fetch`. Building the rest of the event would test SvelteKit, not the
 * page — so the narrowing lives here once, described, rather than as a pair of
 * bare `as any` at each of the five call sites.
 */
async function runLoad(url: URL): Promise<LoadResult> {
	const result = await load({ url, fetch: vi.fn() } as unknown as Parameters<typeof load>[0]);
	// `PageLoad` is allowed to return nothing; this one always returns data, and
	// narrowing here is what lets each assertion below read a real property.
	if (!result) throw new Error('load() returned no data');
	return result as LoadResult;
}

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

	it('counts OPEN+FULL as open and maps standby to PREPARE', async () => {
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [
				{
					code: 'SH001',
					name: 'สแตนด์บาย',
					status: 'standby',
					capacity: 100,
					updated_at: '2026-08-19T00:00:00Z'
				},
				{
					code: 'SH002',
					name: 'เปิด',
					status: 'open',
					capacity: 100,
					updated_at: '2026-08-19T00:00:00Z'
				},
				{
					code: 'SH003',
					name: 'เต็ม',
					status: 'full',
					capacity: 100,
					updated_at: '2026-08-19T00:00:00Z'
				}
			],
			count: 3,
			as_of: '2026-08-19T10:00:00Z'
		});

		const url = new URL('http://localhost/shelters');
		const result = await runLoad(url);

		expect(result.summary.shelters_total).toBe(3);
		expect(result.summary.shelters_open).toBe(2);
		expect(result.shelters[0].status).toBe('PREPARE');
		expect(result.shelters[1].status).toBe('OPEN');
		expect(result.shelters[2].status).toBe('FULL');
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

	it('sorts shelters closest-first when user_lat/user_lng are set', async () => {
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [
				{
					code: 'FAR',
					name: 'ไกล',
					status: 'open',
					capacity: 50,
					geo: { lat: 7.1, lng: 100.6 },
					updated_at: '2026-08-19T00:00:00Z'
				},
				{
					code: 'NEAR',
					name: 'ใกล้',
					status: 'open',
					capacity: 50,
					geo: { lat: 7.01, lng: 100.48 },
					updated_at: '2026-08-19T00:00:00Z'
				},
				{
					code: 'NOGEO',
					name: 'ไม่มีพิกัด',
					status: 'open',
					capacity: 50,
					geo: null,
					updated_at: '2026-08-19T00:00:00Z'
				}
			],
			count: 3,
			as_of: '2026-08-19T10:00:00Z'
		});

		const url = new URL('http://localhost/shelters?user_lat=7.008&user_lng=100.476&distance=50');
		const result = await runLoad(url);

		expect(result.shelters.map((s: PublicShelterCardModel) => s.code)).toEqual([
			'NEAR',
			'FAR',
			'NOGEO'
		]);
		expect(result.shelters[0].distance).toBeLessThan(result.shelters[1].distance);
	});

	it('resolves shelter_type / admin_type ref id to human-readable label', async () => {
		vi.mocked(fetchShelterTypes).mockResolvedValue([
			{ code: '01K_SCHOOL_ID', label: 'โรงเรียน' },
			{ code: '01K_TEMPLE_ID', label: 'วัด' }
		]);

		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [
				{
					code: 'SH001',
					name: 'ศูนย์โรงเรียน',
					admin_type: '01K_SCHOOL_ID',
					status: 'open',
					capacity: 100,
					province: 'เชียงใหม่',
					district: 'เมือง',
					updated_at: '2026-08-19T00:00:00Z'
				},
				{
					code: 'SH002',
					name: 'ศูนย์วัด',
					admin_type: '01K_TEMPLE_ID',
					status: 'open',
					capacity: 50,
					province: 'เชียงใหม่',
					district: 'เมือง',
					updated_at: '2026-08-19T00:00:00Z'
				}
			],
			count: 2,
			as_of: '2026-08-19T10:00:00Z'
		});

		const url = new URL('http://localhost/shelters');
		const result = await runLoad(url);

		expect(result.shelters[0].admin_type).toBe('โรงเรียน');
		expect(result.shelters[1].admin_type).toBe('วัด');
		expect(result.available_types).toEqual(['โรงเรียน', 'วัด']);
	});

	it('filters by shelter_type label correctly', async () => {
		vi.mocked(fetchShelterTypes).mockResolvedValue([
			{ code: '01K_SCHOOL_ID', label: 'โรงเรียน' },
			{ code: '01K_TEMPLE_ID', label: 'วัด' }
		]);

		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [
				{
					code: 'SH001',
					name: 'ศูนย์โรงเรียน',
					admin_type: '01K_SCHOOL_ID',
					status: 'open',
					capacity: 100,
					province: 'เชียงใหม่',
					district: 'เมือง',
					updated_at: '2026-08-19T00:00:00Z'
				},
				{
					code: 'SH002',
					name: 'ศูนย์วัด',
					admin_type: '01K_TEMPLE_ID',
					status: 'open',
					capacity: 50,
					province: 'เชียงใหม่',
					district: 'เมือง',
					updated_at: '2026-08-19T00:00:00Z'
				}
			],
			count: 2,
			as_of: '2026-08-19T10:00:00Z'
		});

		const url = new URL('http://localhost/shelters?type=โรงเรียน');
		const result = await runLoad(url);

		expect(result.shelters).toHaveLength(1);
		expect(result.shelters[0].code).toBe('SH001');
		expect(result.shelters[0].admin_type).toBe('โรงเรียน');
	});
});
