import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorizeSession, serviceError, ServiceError } from '$lib/server/couch-admin';
import { resolveStaffCard } from '$lib/server/staff-card-service';

export const prerender = false;

/** POST { payload, shelter_code } — resolve a scanned card to its recipient for distribution */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeSession(request.headers.get('cookie'));

		const body = (await request.json().catch(() => ({}))) as {
			payload?: unknown;
			shelter_code?: unknown;
		};
		const payload = typeof body.payload === 'string' ? body.payload.trim() : '';
		const shelterCode = typeof body.shelter_code === 'string' ? body.shelter_code.trim() : '';

		if (!payload || !shelterCode) {
			throw new ServiceError('VALIDATION', 'payload and shelter_code are required');
		}

		const recipient = await resolveStaffCard(caller, payload, shelterCode);
		return json(recipient, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		return serviceError(e);
	}
};
