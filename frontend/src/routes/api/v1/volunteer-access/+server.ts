import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ServiceError, readSessionUserCtx, serviceError } from '$lib/server/couch-admin';
import { grantVolunteerAccessAsCoordinator } from '$lib/features/volunteers/server/volunteer-access-grant';

// Service plane `/api/v1/*` (dev BFF). A volunteer_coordinator gives a volunteer limited,
// time-boxed system access (#955). The generic `POST /api/v1/users` stays SA/SM only; every
// coordinator rule is enforced in `grantVolunteerAccessAsCoordinator`.
export const prerender = false;

/** POST — grant `role` until the end of `expires_on` to a volunteer of the coordinator's shelter. */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const { name, roles } = await readSessionUserCtx(request.headers.get('cookie'));
		if (!name) throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
		const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
		const result = await grantVolunteerAccessAsCoordinator(
			{ name, roles },
			{
				shelter_code: body.shelter_code,
				volunteer_id: body.volunteer_id,
				email: body.email,
				password: body.password,
				role: body.role,
				expires_on: body.expires_on
			}
		);
		return json({ ok: true, ...result });
	} catch (e) {
		return serviceError(e);
	}
};
