import { describe, expect, it, vi, beforeEach } from 'vitest';
import { reverseGeocodeCoordinates, resolveCurrentThaiLocation } from './nominatim';
import * as portal from '$lib/features/public-portal';

describe('nominatim client utility', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('reverseGeocodeCoordinates calls the backend endpoint with coordinates', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				province: 'สงขลา',
				district: 'หาดใหญ่',
				subdistrict: 'คอหงส์',
				postal_code: '90110'
			})
		});
		vi.stubGlobal('fetch', mockFetch);

		const result = await reverseGeocodeCoordinates(7.008, 100.474);
		expect(mockFetch).toHaveBeenCalledWith(
			'/api/public/v1/config/reverse-geocode?lat=7.008&lon=100.474'
		);
		expect(result.province).toBe('สงขลา');
		expect(result.district).toBe('หาดใหญ่');
		expect(result.subdistrict).toBe('คอหงส์');
		expect(result.postal_code).toBe('90110');
	});

	it('resolveCurrentThaiLocation fetches GPS then calls reverse geocode', async () => {
		vi.spyOn(portal, 'requestUserPosition').mockResolvedValue({
			lat: '13.756',
			lng: '100.502'
		});

		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				province: 'กรุงเทพมหานคร',
				district: 'พระนคร',
				subdistrict: 'บวรนิเวศ',
				postal_code: '10200'
			})
		});
		vi.stubGlobal('fetch', mockFetch);

		const result = await resolveCurrentThaiLocation();
		expect(result.province).toBe('กรุงเทพมหานคร');
		expect(result.district).toBe('พระนคร');
		expect(result.subdistrict).toBe('บวรนิเวศ');
	});
});
