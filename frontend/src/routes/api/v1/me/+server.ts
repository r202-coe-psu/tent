import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireShelterScopeOrSA, serviceError } from '$lib/server/couch-admin';
import { getCurrentUserProfile } from '$lib/server/user-service';

export const prerender = false;

export const GET: RequestHandler = async ({ request }) => {
	try {
		const caller = await requireShelterScopeOrSA(request.headers.get('cookie'));
		return json(await getCurrentUserProfile(caller.name));
	} catch (error) {
		return serviceError(error);
	}
};
