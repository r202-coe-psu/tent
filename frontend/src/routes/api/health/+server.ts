import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const prerender = false;

/** Liveness endpoint used by Docker before starting the private import worker. */
export const GET: RequestHandler = () =>
	json({ ok: true, service: 'frontend' }, { headers: { 'cache-control': 'no-store, max-age=0' } });
