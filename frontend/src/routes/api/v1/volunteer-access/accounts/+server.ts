import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ServiceError, readSessionUserCtx, serviceError } from '$lib/server/couch-admin';
import { listShelterVolunteerAccounts } from '$lib/features/volunteers/server/volunteer-access-grant';

// Service plane `/api/v1/*` (dev BFF). The volunteer accounts of a shelter with their roles there
// (#1044), for SA / SM / volunteer_coordinator; the policy lives in `listShelterVolunteerAccounts`.
export const prerender = false;

/** GET `?shelter_code=` — `{ ok, accounts }`. */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const { name, roles } = await readSessionUserCtx(request.headers.get('cookie'));
		if (!name) throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
		const accounts = await listShelterVolunteerAccounts(
			{ roles },
			{ shelter_code: url.searchParams.get('shelter_code') ?? '' }
		);
		return json({ ok: true, accounts });
	} catch (e) {
		return serviceError(e);
	}
};
