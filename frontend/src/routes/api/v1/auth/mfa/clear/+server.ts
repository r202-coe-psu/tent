import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearMfaOkCookie } from '$lib/server/google-oauth';

export const prerender = false;

/**
 * POST — Clear the session-scoped `mfa_ok` cookie.
 * Called after password login / logout so each AuthSession round requires step-up again.
 */
export const POST: RequestHandler = async ({ cookies }) => {
	clearMfaOkCookie(cookies);
	return json({ ok: true });
};
