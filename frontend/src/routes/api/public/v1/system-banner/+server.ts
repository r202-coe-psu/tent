import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readSystemBanner } from '$lib/server/system-banner';

export const prerender = false;

/**
 * GET /api/public/v1/system-banner — `{ enabled, message, variant }` for the system banner.
 * Anonymous-safe: exposes only the banner fields of config:app.
 */
export const GET: RequestHandler = async () => {
	const banner = await readSystemBanner();
	return json(banner, { headers: { 'Cache-Control': 'no-store' } });
};
