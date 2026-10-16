import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA, serviceError } from '$lib/server/couch-admin';
import { listShelterStaffDirectory } from '$lib/server/user-service';

export const prerender = false;

/**
 * GET /api/v1/shelters/{code}/staff — colleague names for the incident handover picker.
 * Any caller in the shelter scope (or SA); returns `{ name, display_name }[]` only.
 */
export const GET: RequestHandler = async ({ request, params }) => {
	try {
		await requireShelterScopeOrSA(request.headers.get('cookie'), params.code);
		return json(await listShelterStaffDirectory(params.code));
	} catch (e) {
		// The scope gate throws SvelteKit 401/403 — let those through instead of masking as 500.
		if (isHttpError(e)) throw e;
		return serviceError(e);
	}
};
