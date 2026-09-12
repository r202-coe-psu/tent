import { requestUserPosition } from '$lib/features/public-portal';

export interface ThaiLocationResult {
	province?: string;
	district?: string;
	subdistrict?: string;
	postal_code?: string;
	road?: string;
	display_name?: string;
}

/**
 * Call the backend reverse-geocode service which queries OpenStreetMap Nominatim
 * and matches the result with the canonical Thailand administrative dataset.
 */
export async function reverseGeocodeCoordinates(
	lat: number | string,
	lon: number | string
): Promise<ThaiLocationResult> {
	const res = await fetch(
		`/api/public/v1/config/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
	);

	if (!res.ok) {
		throw new Error('ไม่สามารถค้นหาข้อมูลที่อยู่จากพิกัดได้');
	}

	return (await res.json()) as ThaiLocationResult;
}

/**
 * Gets the user's current GPS position via browser Geolocation API
 * and resolves it to Thailand province, district, subdistrict, and postal code
 * using OpenStreetMap Nominatim.
 */
export async function resolveCurrentThaiLocation(): Promise<ThaiLocationResult> {
	const coords = await requestUserPosition({
		enableHighAccuracy: true,
		timeout: 10_000,
		maximumAge: 60_000
	});

	return reverseGeocodeCoordinates(coords.lat, coords.lng);
}
