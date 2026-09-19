import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consumeCitizenClaimCookie } from '$lib/server/thaid-oauth';

export const prerender = false;

/**
 * GET /api/public/v1/thaid/claim
 * Reads and consumes the short-lived HttpOnly signed cookie `thaid_citizen_claim`,
 * returning the citizen autofill profile to the client form and deleting the cookie.
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const profile = consumeCitizenClaimCookie(cookies);
	return json({ profile }, { headers: { 'Cache-Control': 'no-store' } });
};
