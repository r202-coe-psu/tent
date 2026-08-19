import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load } from './+page';

vi.mock('$lib/features/public-portal', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/features/public-portal')>();
	return {
		...actual,
		listPublicShelters: vi.fn()
	};
});

import { listPublicShelters } from '$lib/features/public-portal';

describe('public/shelters load function', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns empty shelters list gracefully when listPublicShelters throws an error', async () => {
		vi.mocked(listPublicShelters).mockRejectedValue(
			new Error('Network error / Service unavailable')
		);

		const url = new URL('http://localhost/shelters');
		const result = (await load({
			url,
			fetch: vi.fn()
		} as any)) as any;

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
		const result = (await load({
			url,
			fetch: vi.fn()
		} as any)) as any;

		expect(result.shelters).toEqual([]);
		expect(result.count).toBe(0);
		expect(result.summary.shelters_total).toBe(0);
		expect(result.summary.shelters_open).toBe(0);
		expect(result.as_of).toBe('2026-08-19T10:00:00Z');
	});

	it('handles null or undefined shelters property safely', async () => {
		vi.mocked(listPublicShelters).mockResolvedValue({
			shelters: undefined as any,
			count: 0,
			as_of: '2026-08-19T10:00:00Z'
		});

		const url = new URL('http://localhost/shelters');
		const result = (await load({
			url,
			fetch: vi.fn()
		} as any)) as any;

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
		const result = (await load({
			url,
			fetch: vi.fn()
		} as any)) as any;

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
		const result = (await load({
			url,
			fetch: vi.fn()
		} as any)) as any;

		expect(result.shelters).toHaveLength(1);
		expect(result.shelters[0].code).toBe('SH001');
	});
});
