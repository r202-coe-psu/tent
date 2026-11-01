import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';
import { rotateStaffCard } from '$lib/server/staff-card-service';

export const prerender = false;

/** POST { name } — Admin issues a new permanent QR for a staff member, invalidating the old one */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		const body = (await request.json().catch(() => ({}))) as { name?: unknown };
		const name = typeof body.name === 'string' ? body.name.trim() : '';

		if (!name) {
			throw new ServiceError('VALIDATION', 'name is required');
		}

		const card = await rotateStaffCard(caller, name);
		return json(card, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		return serviceError(e);
	}
};
