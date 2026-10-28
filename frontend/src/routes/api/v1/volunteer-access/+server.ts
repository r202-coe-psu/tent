import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ServiceError, readSessionUserCtx, serviceError } from '$lib/server/couch-admin';
import {
	grantVolunteerAccessAsCoordinator,
	revokeVolunteerAccessAsCoordinator
} from '$lib/features/volunteers/server/volunteer-access-grant';

// Service plane `/api/v1/*` (dev BFF). A volunteer_coordinator gives a volunteer limited,
// time-boxed system access (#955). The generic `POST /api/v1/users` stays SA/SM only; every
// coordinator rule is enforced in `grantVolunteerAccessAsCoordinator` and
// `revokeVolunteerAccessAsCoordinator`.
export const prerender = false;

/**
 * POST — grant `role` until the end of `expires_on` to a volunteer of the coordinator's shelter.
 * Posting again renews it, or shortens it (an earlier `expires_on`, only for the caller's grants).
 */
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

/** DELETE — take back a grant the caller issued: the role goes, the account and password stay. */
export const DELETE: RequestHandler = async ({ request }) => {
	try {
		const { name, roles } = await readSessionUserCtx(request.headers.get('cookie'));
		if (!name) throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
		const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
		await revokeVolunteerAccessAsCoordinator(
			{ name, roles },
			{
				shelter_code: body.shelter_code,
				volunteer_id: body.volunteer_id,
				email: body.email,
				role: body.role
			}
		);
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};
