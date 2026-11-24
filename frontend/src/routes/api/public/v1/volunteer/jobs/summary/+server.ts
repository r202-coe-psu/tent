import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import { readMasterDoc } from '$lib/server/master-data-server';
import { loadCouchBoard } from '$lib/features/volunteers/server/public-board-couch';
import {
	controlledValuesFromMaster,
	summarizeFallbackJobs
} from '$lib/features/volunteers/server/public-board-fallback';

export const prerender = false;

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Board-wide counts for `/volunteers/jobs` (CR-265 FR-9/10/11): total, open, near-full and
 * controlled jobs, ignoring the board's filters and page. FastAPI answers; CouchDB only while
 * FastAPI is unreachable or failing.
 */
export const GET: RequestHandler = async ({ fetch }) => {
	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/jobs/summary`, {
			headers: fastapiServiceHeaders()
		});
		if (res.ok) return json(await res.json(), { headers: NO_STORE });
		if (res.status >= 400 && res.status < 500) {
			const body = await res.json().catch(() => ({ success: false }));
			return json(body, { status: res.status, headers: NO_STORE });
		}
	} catch {
		// FastAPI offline: count from CouchDB below.
	}

	try {
		const { jobs } = await loadCouchBoard();
		const master = await readMasterDoc('volunteer_skills').catch(() => null);
		const counts = summarizeFallbackJobs(jobs, controlledValuesFromMaster(master?.items ?? []));
		return json(
			{ success: true, ...counts, as_of: new Date().toISOString() },
			{ headers: NO_STORE }
		);
	} catch (err) {
		console.warn('Failed to load public volunteer jobs summary:', err);
		return json({ success: false }, { status: 503 });
	}
};
