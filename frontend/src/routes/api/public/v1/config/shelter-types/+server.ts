import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readMasterDoc } from '$lib/server/master-data-server';

export const prerender = false;

/**
 * GET /api/public/v1/config/shelter-types — code → label for shelter_type.
 *
 * The public shelter payload carries `admin_type` as a raw
 * `master_data:shelter_type` code (`item_01M…`); cards and detail pages need
 * the Thai labels. `master_data` is not projected into Mongo, so this reads
 * the registry directly — same CouchDB-only path as vulnerable-groups.
 *
 * Reference data with no PII: cacheable, and degrades to an empty list rather
 * than failing the directory.
 */
export const GET: RequestHandler = async () => {
	try {
		const doc = await readMasterDoc('shelter_type');
		const types = (doc?.items ?? [])
			.filter((item) => item.status !== 'inactive')
			.map((item) => ({ code: item.code, label: item.label }));

		return json(
			{ types, shelterTypes: types },
			{ headers: { 'Cache-Control': 'public, max-age=300' } }
		);
	} catch (e) {
		console.warn('shelter-types lookup failed:', e);
		return json({ types: [], shelterTypes: [] }, { headers: { 'Cache-Control': 'no-store' } });
	}
};
