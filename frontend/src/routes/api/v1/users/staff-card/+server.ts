import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { getStaffCardForAdmin } from '$lib/server/staff-card-service';

export const prerender = false;

/** GET ?name= — Admin reads a staff member's permanent QR card for printing */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		const name = url.searchParams.get('name')?.trim() ?? '';

		if (!name) {
			throw new ServiceError('VALIDATION', 'name is required');
		}

		const card = await getStaffCardForAdmin(caller, name);
		return json(card, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		return serviceError(e);
	}
};
