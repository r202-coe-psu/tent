import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { matchThaiLocation, type ReverseGeocodeResult } from '$lib/server/thailand-location';

export const prerender = false;

export type { ReverseGeocodeResult };

/**
 * GET /api/public/v1/config/reverse-geocode?lat=13.75&lon=100.50
 * Reverse-geocodes GPS coordinates via OpenStreetMap Nominatim and matches
 * the Thai administrative data.
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const lat = Number.parseFloat(url.searchParams.get('lat') ?? '');
	const lon = Number.parseFloat(url.searchParams.get('lon') ?? '');

	if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
		return json({ error: 'invalid coordinates' }, { status: 400 });
	}

	const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=th`;

	try {
		const res = await fetch(nominatimUrl, {
			headers: {
				'User-Agent': 'SmartShelter-Thailand/1.0 (https://github.com/r202-coe-psu/tent)'
			}
		});

		if (!res.ok) {
			return json({ error: 'reverse geocode service unavailable' }, { status: 502 });
		}

		const data = (await res.json()) as {
			address?: Record<string, string>;
			display_name?: string;
		};

		const matched = matchThaiLocation(data);

		return json(matched, {
			headers: {
				'Cache-Control': 'public, max-age=3600'
			}
		});
	} catch (err) {
		console.warn('reverse geocode failed:', err);
		return json({ error: 'reverse geocode request failed' }, { status: 500 });
	}
};
