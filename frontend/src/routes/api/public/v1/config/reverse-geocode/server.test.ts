import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { matchThaiLocation } from '$lib/server/thailand-location';

describe('matchThaiLocation', () => {
	it('matches Bangkok address correctly', () => {
		const result = matchThaiLocation({
			display_name:
				'วงเวียนอนุสาวรีย์ประชาธิปไตย, ชุมชนหลังวัดราชนัดดา, แขวงบวรนิเวศ, เขตพระนคร, กรุงเทพมหานคร, 10200',
			address: {
				city: 'กรุงเทพมหานคร',
				suburb: 'เขตพระนคร',
				quarter: 'แขวงบวรนิเวศ',
				postcode: '10200',
				road: 'ถนนราชดำเนิน'
			}
		});

		expect(result.province).toBe('กรุงเทพมหานคร');
		expect(result.district).toBe('พระนคร');
		expect(result.subdistrict).toBe('บวรนิเวศ');
		expect(result.postal_code).toBe('10200');
		expect(result.road).toBe('ถนนราชดำเนิน');
	});

	it('matches Songkhla Hat Yai address with prefixes', () => {
		const result = matchThaiLocation({
			display_name: 'ถนนศุภสารรังสรรค์, คอหงส์, อำเภอหาดใหญ่, จังหวัดสงขลา, 90110',
			address: {
				province: 'จังหวัดสงขลา',
				county: 'อำเภอหาดใหญ่',
				municipality: 'คอหงส์',
				postcode: '90110'
			}
		});

		expect(result.province).toBe('สงขลา');
		expect(result.district).toBe('หาดใหญ่');
		expect(result.subdistrict).toBe('คอหงส์');
		expect(result.postal_code).toBe('90110');
	});

	it('falls back to subdistrict matching via display_name when subdistrict field is absent', () => {
		const result = matchThaiLocation({
			display_name:
				'วงเวียนสุรินทร์, ตลาดใหญ่, เทศบาลนครภูเก็ต, อำเภอเมืองภูเก็ต, จังหวัดภูเก็ต, 83000',
			address: {
				province: 'จังหวัดภูเก็ต',
				county: 'อำเภอเมืองภูเก็ต',
				postcode: '83000'
			}
		});

		expect(result.province).toBe('ภูเก็ต');
		expect(result.district).toBe('เมืองภูเก็ต');
		expect(result.subdistrict).toBe('ตลาดใหญ่');
		expect(result.postal_code).toBe('83000');
	});
});

describe('GET /api/public/v1/config/reverse-geocode', () => {
	it('returns 400 when lat or lon is missing or invalid', async () => {
		const url = new URL('http://localhost/api/public/v1/config/reverse-geocode?lat=abc&lon=def');
		const res = await GET({
			url,
			fetch: vi.fn()
		} as unknown as Parameters<typeof GET>[0]);

		expect(res.status).toBe(400);
	});

	it('calls Nominatim and returns mapped Thai address on success', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				display_name: 'ถนนศุภสารรังสรรค์, คอหงส์, อำเภอหาดใหญ่, จังหวัดสงขลา, 90110',
				address: {
					province: 'จังหวัดสงขลา',
					county: 'อำเภอหาดใหญ่',
					municipality: 'คอหงส์',
					postcode: '90110'
				}
			})
		});

		const url = new URL(
			'http://localhost/api/public/v1/config/reverse-geocode?lat=7.008&lon=100.474'
		);
		const res = await GET({
			url,
			fetch: mockFetch
		} as unknown as Parameters<typeof GET>[0]);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.province).toBe('สงขลา');
		expect(data.district).toBe('หาดใหญ่');
		expect(data.subdistrict).toBe('คอหงส์');
		expect(data.postal_code).toBe('90110');
	});
});
