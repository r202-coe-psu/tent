import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const prerender = false;

/**
 * GET /api/public/v1/shelters/summary → FastAPI (Bearer EXTERNAL_API_SECRET).
 *
 * Head counts for the `/shelters` cards. They do not follow the list filters, so the numbers stay
 * put while the visitor searches (#1419). Only `hide_host_house` is passed on.
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const upstream = new URL(`${fastapiBaseUrl()}/public/v1/shelters/summary`);
	const hideHostHouse = url.searchParams.get('hide_host_house');
	if (hideHostHouse) upstream.searchParams.set('hide_host_house', hideHostHouse);

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
			{
				error: { code: 'SHELTERS_UNAVAILABLE', message: 'Shelter summary temporarily unavailable' }
			},
			{ status: 503 }
		);
	}
};
