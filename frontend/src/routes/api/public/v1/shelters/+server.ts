import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/** GET /api/public/v1/shelters → FastAPI (Bearer EXTERNAL_API_SECRET). */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const upstream = new URL(`${fastapiBaseUrl()}/public/v1/shelters`);
	for (const key of [
		'province',
		'district',
		'subdistrict',
		'status',
		'site_kind',
		'lat',
		'lng',
		'radius_km'
	] as const) {
		const value = url.searchParams.get(key);
		if (value) upstream.searchParams.set(key, value);
	}

	try {
		const res = await fetch(upstream.toString(), {
			headers: fastapiServiceHeaders()
		});
		const payload = await res.json().catch(() => ({}));
		return json(payload, {
			status: res.status,
			headers: { 'Cache-Control': 'public, max-age=60' }
		});
	} catch {
		return json(
			{ error: { code: 'SHELTERS_UNAVAILABLE', message: 'Shelter list temporarily unavailable' } },
			{ status: 503 }
		);
	}
};
