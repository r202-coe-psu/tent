import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isThaidRegistrationEnabled } from '$lib/server/thaid-registration-gate';

export const prerender = false;

/**
 * GET /api/public/v1/thaid/status — whether the browser should show ThaiD
 * (login, staff /me link, public pre-register).
 */
export const GET: RequestHandler = async () => {
	const status = await isThaidRegistrationEnabled();
	return json(status, { headers: { 'Cache-Control': 'no-store' } });
};
