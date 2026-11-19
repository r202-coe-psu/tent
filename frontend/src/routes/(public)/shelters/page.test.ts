import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load } from './+page';

vi.mock('$lib/features/public-portal', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/features/public-portal')>();
	return {
		...actual,
		listPublicShelters: vi.fn(),
		fetchShelterSummary: vi.fn(),
		fetchShelterTypes: vi.fn().mockResolvedValue([])
	};
});

import {
	listPublicShelters,
	fetchShelterSummary,
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
		counts_by_site_kind: Record<string, number>;
	} | null;
	filters: Record<string, string>;
	available_types: string[];
};

const SUMMARY = {
	shelters_total: 210,
	shelters_open: 150,
	counts_by_site_kind: { evacuation_center: 200, field_hospital: 10 }
};

/**
 * `load` is typed against SvelteKit's full `LoadEvent`, but this page reads only
 * `url` and `fetch`. Building the rest of the event would test SvelteKit, not the
 * page — so the narrowing lives here once, described, rather than as a pair of
 * bare `as any` at each of the call sites.
 */
async function runLoad(url: URL): Promise<LoadResult> {
	const result = await load({ url, fetch: vi.fn() } as unknown as Parameters<typeof load>[0]);
	// `PageLoad` is allowed to return nothing; this one always returns data, and
	// narrowing here is what lets each assertion below read a real property.
	if (!result) throw new Error('load() returned no data');
	return result as LoadResult;
}

const listCall = () => vi.mocked(listPublicShelters).mock.calls[0][0];

const item = (code: string, extra: Record<string, unknown> = {}) => ({
	code,
	name: code,
	status: 'open',
	capacity: 1,
	accepts_pre_registration: false,
	updated_at: '2026-08-19T00:00:00Z',
	...extra
});

describe('public/shelters load function', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fetchShelterTypes).mockResolvedValue([]);
		vi.mocked(fetchShelterSummary).mockResolvedValue(SUMMARY);
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [],
			count: 0,
			as_of: '2026-08-19T10:00:00Z'
		});
	});

	it('returns empty shelters list gracefully when listPublicShelters throws an error', async () => {
		vi.mocked(listPublicShelters).mockRejectedValue(
			new Error('Network error / Service unavailable')
		);

		const result = await runLoad(new URL('http://localhost/shelters'));

		expect(result.shelters).toEqual([]);
		expect(result.count).toBe(0);
		// the cards do not depend on the list
		expect(result.summary).toEqual(SUMMARY);
	});

	it('still lists shelters when the shelter-type labels cannot be loaded', async () => {
		vi.mocked(fetchShelterTypes).mockRejectedValue(new Error('labels down'));
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [item('SH001', { admin_type: '01K_SCHOOL_ID' })],
			count: 1,
			as_of: '2026-08-19T10:00:00Z'
		} as unknown as PublicShelterListResponse);

		const result = await runLoad(new URL('http://localhost/shelters'));

		expect(result.shelters.map((s) => s.code)).toEqual(['SH001']);
	});

	it('handles null or undefined shelters property safely', async () => {
		// Deliberately malformed: the point of the test is that a payload missing
		// `shelters` does not blow up the load, so it cannot satisfy the response type.
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: undefined,
			count: 0,
			as_of: '2026-08-19T10:00:00Z'
		} as unknown as PublicShelterListResponse);

		const result = await runLoad(new URL('http://localhost/shelters'));

		expect(result.shelters).toEqual([]);
		expect(result.count).toBe(0);
		expect(result.as_of).toBe('2026-08-19T10:00:00Z');
	});

	it('maps valid shelter items with safe property handling', async () => {
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [
				item('SH001', {
					name: 'ศูนย์ช่วยเหลือเทศบาล',
					capacity: 150,
					geo: { lat: 7.008, lng: 100.476 },
					province: 'สงขลา',
					district: 'หาดใหญ่',
					subdistrict: 'หาดใหญ่'
				}),
				item('SH002', {
					name: 'ศูนย์พักพิงโรงเรียน',
					status: 'closed',
					capacity: 80,
					geo: null,
					province: 'สงขลา',
					district: 'หาดใหญ่',
					subdistrict: 'คอหงส์'
				})
			],
			count: 2,
			as_of: '2026-08-19T10:00:00Z'
		} as unknown as PublicShelterListResponse);

		const result = await runLoad(new URL('http://localhost/shelters'));

		expect(result.shelters).toHaveLength(2);
		expect(result.count).toBe(2);
		expect(result.shelters[0].name).toBe('ศูนย์ช่วยเหลือเทศบาล');
		expect(result.shelters[0].status).toBe('OPEN');
		expect(result.shelters[1].status).toBe('CLOSED');
	});

	it('maps standby to PREPARE and keeps open and full as they are', async () => {
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [
				item('SH001', { status: 'standby' }),
				item('SH002', { status: 'open' }),
				item('SH003', { status: 'full' })
			],
			count: 3,
			as_of: '2026-08-19T10:00:00Z'
		} as unknown as PublicShelterListResponse);

		const result = await runLoad(new URL('http://localhost/shelters'));

		expect(result.shelters.map((s) => s.status)).toEqual(['PREPARE', 'OPEN', 'FULL']);
	});

	it('passes the unknown status filter to the API and maps external shelters (CR-252)', async () => {
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [
				item('EXT1', {
					name: 'ศูนย์ภายนอก',
					status: 'unknown',
					capacity: 0,
					is_external: true,
					external_url: 'https://example.org/x'
				})
			],
			count: 1,
			as_of: '2026-11-12T10:00:00Z'
		} as unknown as PublicShelterListResponse);

		const result = await runLoad(new URL('http://localhost/shelters?status=unknown'));

		expect(listCall()).toMatchObject({ status: 'unknown' });
		expect(result.shelters[0]).toMatchObject({
			status: 'UNKNOWN',
			is_external: true,
			external_url: 'https://example.org/x'
		});
	});

	it('resolves shelter_type / admin_type ref id to human-readable label', async () => {
		vi.mocked(fetchShelterTypes).mockResolvedValue([
			{ code: '01K_SCHOOL_ID', label_th: 'โรงเรียน', label_en: 'School' },
			{ code: '01K_TEMPLE_ID', label_th: 'วัด', label_en: 'Temple' }
		]);
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: [
				item('SH001', { admin_type: '01K_SCHOOL_ID' }),
				item('SH002', { admin_type: '01K_TEMPLE_ID' })
			],
			count: 2,
			as_of: '2026-08-19T10:00:00Z'
		} as unknown as PublicShelterListResponse);

		const result = await runLoad(new URL('http://localhost/shelters'));

		expect(result.shelters[0].admin_type).toBe('โรงเรียน');
		expect(result.shelters[1].admin_type).toBe('วัด');
		expect(result.available_types).toEqual(['โรงเรียน', 'วัด']);
	});

	it('ignores a legacy ?site_kind= param: the panel has no control for it any more', async () => {
		const result = await runLoad(new URL('http://localhost/shelters?site_kind=host_house'));

		expect(listCall()?.site_kind).toBeUndefined();
		expect(result.filters.site_kind).toBeUndefined();
	});

	// #1419 — the database filters; the page only passes the visitor's choices on.
	describe('filters run in the database', () => {
		it('asks for nothing narrow by default, except leaving out plain host houses', async () => {
			await runLoad(new URL('http://localhost/shelters'));

			expect(listCall()).toMatchObject({
				hide_host_house: true,
				hide_full: false,
				hide_evacuation: false,
				hide_external: false,
				parking: []
			});
			expect(listCall()?.q).toBe('');
			expect(listCall()?.admin_type).toBeUndefined();
			expect(listCall()?.radius_km).toBeUndefined();
		});

		it('passes the search text, location, status and the full toggle', async () => {
			await runLoad(
				new URL(
					'http://localhost/shelters?q=บ้านพรุ&province=สงขลา&district=หาดใหญ่&subdistrict=คอหงส์&status=full&hide_full=true'
				)
			);

			expect(listCall()).toMatchObject({
				q: 'บ้านพรุ',
				province: 'สงขลา',
				district: 'หาดใหญ่',
				subdistrict: 'คอหงส์',
				status: 'full',
				hide_full: true
			});
		});

		it('turns the type label from the URL into the type code the database holds', async () => {
			vi.mocked(fetchShelterTypes).mockResolvedValue([
				{ code: '01K_SCHOOL_ID', label_th: 'โรงเรียน', label_en: 'School' },
				{ code: '01K_TEMPLE_ID', label_th: 'วัด', label_en: 'Temple' }
			]);

			const result = await runLoad(new URL('http://localhost/shelters?type=โรงเรียน'));

			expect(listCall()?.admin_type).toBe('01K_SCHOOL_ID');
			expect(result.filters.type).toBe('โรงเรียน');
		});

		it('passes an unknown type through as typed, so it matches nothing rather than everything', async () => {
			await runLoad(new URL('http://localhost/shelters?type=ไม่มีประเภทนี้'));

			expect(listCall()?.admin_type).toBe('ไม่มีประเภทนี้');
		});

		it('passes the ticked parking types and echoes them back', async () => {
			const result = await runLoad(
				new URL('http://localhost/shelters?parking_car=on&parking_boat=on')
			);

			expect(listCall()?.parking).toEqual(['car', 'boat']);
			expect(result.filters.parking_car).toBe('on');
			expect(result.filters.parking_boat).toBe('on');
			expect(result.filters.parking_motorcycle).toBe('');
		});

		it('passes the switched-off shelter types and echoes them back', async () => {
			const result = await runLoad(
				new URL('http://localhost/shelters?hide_evacuation=on&hide_external=on')
			);

			expect(listCall()).toMatchObject({ hide_evacuation: true, hide_external: true });
			expect(result.filters.hide_evacuation).toBe('on');
			expect(result.filters.hide_external).toBe('on');
		});

		it('always leaves host houses out and ignores a stale hide_host_house', async () => {
			const result = await runLoad(new URL('http://localhost/shelters?hide_host_house=on'));

			expect(listCall()?.hide_host_house).toBe(true);
			expect(result.filters).not.toHaveProperty('hide_host_house');
		});

		it('does not filter the list it gets back — what the database sent is what the page shows', async () => {
			vi.mocked(listPublicShelters).mockResolvedValue({
				shelters: [item('A', { name: 'ไม่ตรงคำค้น' }), item('B', { status: 'full' })],
				count: 2,
				as_of: '2026-08-19T10:00:00Z'
			} as unknown as PublicShelterListResponse);

			const result = await runLoad(new URL('http://localhost/shelters?q=xyz&hide_full=true'));

			expect(result.shelters.map((s) => s.code)).toEqual(['A', 'B']);
		});
	});

	describe('distance (5 km by default)', () => {
		const near = item('NEAR', { geo: { lat: 7.01, lng: 100.48 } });
		const far = item('FAR', { geo: { lat: 7.1, lng: 100.6 } });
		const nogeo = item('NOGEO', { geo: null });

		beforeEach(() => {
			vi.mocked(listPublicShelters).mockResolvedValue({
				shelters: [far, nogeo, near],
				count: 3,
				as_of: '2026-08-19T10:00:00Z'
			} as unknown as PublicShelterListResponse);
		});

		it('defaults the radius to 5 km, but sends nothing without a position', async () => {
			const result = await runLoad(new URL('http://localhost/shelters'));

			expect(result.filters.distance).toBe('5');
			expect(listCall()?.radius_km).toBeUndefined();
			expect(listCall()?.lat).toBeUndefined();
			expect(listCall()?.lng).toBeUndefined();
		});

		it('with a position but no radius in the URL, hands the 5 km default to the database', async () => {
			const result = await runLoad(
				new URL('http://localhost/shelters?user_lat=7.008&user_lng=100.476')
			);

			expect(listCall()).toMatchObject({ lat: 7.008, lng: 100.476, radius_km: 5 });
			expect(result.filters.distance).toBe('5');
		});

		it('with a position and a radius, hands both to the database', async () => {
			const result = await runLoad(
				new URL('http://localhost/shelters?user_lat=7.008&user_lng=100.476&distance=10')
			);

			expect(listCall()).toMatchObject({ lat: 7.008, lng: 100.476, radius_km: 10 });
			expect(result.filters.distance).toBe('10');
			expect(result.shelters[0].code).toBe('NEAR');
		});

		it('a cleared radius (distance=) keeps every shelter, closest-first', async () => {
			const result = await runLoad(
				new URL('http://localhost/shelters?user_lat=7.008&user_lng=100.476&distance=')
			);

			// the database is not asked to cut by distance, or it would lose shelters with no pin
			expect(listCall()?.radius_km).toBeUndefined();
			expect(listCall()?.lat).toBeUndefined();
			expect(result.shelters.map((s) => s.code)).toEqual(['NEAR', 'FAR', 'NOGEO']);
			expect(result.shelters[0].distance).toBeLessThan(result.shelters[1].distance);
			expect(result.filters.distance).toBe('');
		});

		it('ignores a radius when there is no position to measure from', async () => {
			await runLoad(new URL('http://localhost/shelters?distance=10'));

			expect(listCall()?.radius_km).toBeUndefined();
		});
	});

	describe('the cards come from the summary, not from the list', () => {
		it('shows the summary the endpoint gave, whatever the list holds', async () => {
			vi.mocked(listPublicShelters).mockResolvedValue({
				shelters: [item('ONLY')],
				count: 1,
				as_of: '2026-08-19T10:00:00Z'
			} as unknown as PublicShelterListResponse);

			const result = await runLoad(new URL('http://localhost/shelters?q=ONLY&hide_external=on'));

			expect(result.shelters).toHaveLength(1);
			expect(result.summary).toEqual(SUMMARY);
		});

		it('asks for the summary without any filter, but leaving plain host houses out', async () => {
			await runLoad(new URL('http://localhost/shelters?q=x&province=สงขลา&hide_full=true'));

			expect(vi.mocked(fetchShelterSummary)).toHaveBeenCalledTimes(1);
			expect(vi.mocked(fetchShelterSummary).mock.calls[0][0]).toMatchObject({
				hide_host_house: true
			});
			expect(Object.keys(vi.mocked(fetchShelterSummary).mock.calls[0][0] ?? {}).sort()).toEqual([
				'fetch',
				'hide_host_house'
			]);
		});

		it('reports no summary — never zeros — and still lists, when the summary is unavailable', async () => {
			vi.mocked(fetchShelterSummary).mockRejectedValue(new Error('down'));
			vi.mocked(listPublicShelters).mockResolvedValue({
				shelters: [item('SH001')],
				count: 1,
				as_of: '2026-08-19T10:00:00Z'
			} as unknown as PublicShelterListResponse);

			const result = await runLoad(new URL('http://localhost/shelters'));

			expect(result.shelters).toHaveLength(1);
			// zeros would read as "no shelters at all"; the page shows a dash for null
			expect(result.summary).toBeNull();
		});
	});
});
