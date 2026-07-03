import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA, serviceError } from '$lib/server/couch-admin';
import { MASTER_DATA_TYPES } from '$lib/features/master-data';
import { readMasterDoc } from '$lib/server/master-data-server';

/**
 * Dev-only admin API for the Master Data Engine (CR-012). Never prerendered
 * (absent from the static prod build) — production builds run this through a
 * reverse proxy → FastAPI. Reads (GET) are open to any authenticated user
 * (CR-012 §2: "Read: any authenticated role") so shelter staff can populate
 * registration dropdowns; the server still uses admin creds to reach `registry`.
 */
export const prerender = false;

/** GET — list all 5 master_data docs (one per master_type). Missing docs come
 *  back as `{ items: [] }` placeholders so the UI can render all 5 cards. */
export const GET: RequestHandler = async ({ request }) => {
	await requireShelterScopeOrSA(request.headers.get('cookie'));
	try {
		const out = await Promise.all(
			MASTER_DATA_TYPES.map(async (type) => {
				const doc = await readMasterDoc(type);
				return {
					_id: `master_data:${type}`,
					master_type: type,
					items: doc?.items ?? []
				};
			})
		);
		return json(out);
	} catch (e) {
		return serviceError(e);
	}
};
