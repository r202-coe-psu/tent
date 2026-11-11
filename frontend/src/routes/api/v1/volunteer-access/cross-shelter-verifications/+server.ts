import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ServiceError, readSessionUserCtx, serviceError } from '$lib/server/couch-admin';
import { findCrossShelterVerifications } from '$lib/features/volunteers/server/cross-shelter-verification';

// Service plane `/api/v1/*` on the central Node server (CR-228 FR-17). Other shelters' in-person
// identity / controlled-skill results for the same person, read with the admin credential; the
// role check, the field filter and the audit live in `findCrossShelterVerifications`.
export const prerender = false;

/** GET `?shelter_code=&volunteer_id=` — `{ ok, matches }`. */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const { name, roles } = await readSessionUserCtx(request.headers.get('cookie'));
		if (!name) throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
		const { matches } = await findCrossShelterVerifications(
			{ name, roles },
			{
				shelter_code: url.searchParams.get('shelter_code') ?? '',
				volunteer_id: url.searchParams.get('volunteer_id') ?? ''
			}
		);
		return json({ ok: true, matches });
	} catch (e) {
		return serviceError(e);
	}
};
