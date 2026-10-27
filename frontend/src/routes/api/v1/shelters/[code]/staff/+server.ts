import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA, serviceError } from '$lib/server/couch-admin';
import { listShelterStaffDirectory } from '$lib/server/user-service';

export const prerender = false;

/**
 * GET /api/v1/shelters/{code}/staff — colleague names for the incident handover picker.
 * Any caller in the shelter scope (or SA); returns `{ name, display_name }[]` only.
 * Optional `?capabilities=a,b` (comma-separated) keeps only staff holding one of them.
 */
export const GET: RequestHandler = async ({ request, params, url }) => {
	try {
		await requireShelterScopeOrSA(request.headers.get('cookie'), params.code);
		const capabilities = (url.searchParams.get('capabilities') ?? '')
			.split(',')
			.map((c) => c.trim())
			.filter(Boolean);
		return json(
			await listShelterStaffDirectory(
				params.code,
				capabilities.length ? { capabilities } : undefined
			)
		);
	} catch (e) {
		// The scope gate throws SvelteKit 401/403 — let those through instead of masking as 500.
		if (isHttpError(e)) throw e;
		return serviceError(e);
	}
};
