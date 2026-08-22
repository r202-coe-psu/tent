import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readMasterDoc } from '$lib/server/master-data-server';

export const prerender = false;

/**
 * GET /api/public/v1/config/vulnerable-groups — code → label for the vulnerable
 * groups a shelter can declare support for.
 *
 * The public shelter payload carries `vulnerable_groups` as raw
 * `master_data:vulnerable_group` codes (`item_01M…`); the booking form needs the
 * Thai labels to render each member's checkboxes. `master_data` is not projected
 * into Mongo, so this reads the registry directly — the same CouchDB-only path
 * the rest of the booking flow uses.
 *
 * Reference data with no PII: cacheable, and degrades to an empty list rather
 * than failing the form (a booking without tags is still a valid booking).
 */
export const GET: RequestHandler = async () => {
	try {
		const doc = await readMasterDoc('vulnerable_group');
		const groups = (doc?.items ?? [])
			.filter((item) => item.status !== 'inactive')
			.map((item) => ({ code: item.code, label: item.label }));

		return json({ groups }, { headers: { 'Cache-Control': 'public, max-age=300' } });
	} catch (e) {
		console.warn('vulnerable-groups lookup failed:', e);
		return json({ groups: [] }, { headers: { 'Cache-Control': 'no-store' } });
	}
};
