import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveLoginMethods } from '$lib/server/login-methods';

export const prerender = false;

/** GET /api/public/v1/login-methods — which sign-in methods `/login` shows (CR-141). */
export const GET: RequestHandler = async () => {
	return json(await resolveLoginMethods(), { headers: { 'Cache-Control': 'no-store' } });
};
