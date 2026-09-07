/**
 * Shared staff gate for Unassigned Registration BFF routes (search + claim).
 * Server-only — not exported from the feature barrel.
 */
import { json } from '@sveltejs/kit';
import { canAccessUnassignedRegistrationQueue } from '$lib/auth/roles';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';

const noStore = { 'Cache-Control': 'no-store' };

export type UnassignedRegistrationAuthResult = { ok: true } | { ok: false; response: Response };

/**
 * Require shelter-scoped staff (or SA) with registration queue capability.
 * Returns a ready-made JSON Response on auth failure.
 */
export async function requireUnassignedRegistrationQueueAccess(
	cookie: string | null
): Promise<UnassignedRegistrationAuthResult> {
	try {
		const caller = await requireShelterScopeOrSA(cookie);
		if (!canAccessUnassignedRegistrationQueue(caller.roles, caller.shelterCode)) {
			return {
				ok: false,
				response: json(
					{ error: { code: 'FORBIDDEN', message: 'Requires registration_staff or above' } },
					{ status: 403, headers: noStore }
				)
			};
		}
		return { ok: true };
	} catch (e) {
		const status =
			typeof e === 'object' && e !== null && 'status' in e && typeof e.status === 'number'
				? e.status
				: 401;
		return {
			ok: false,
			response: json(
				{
					error: {
						code: status === 403 ? 'FORBIDDEN' : 'UNAUTHENTICATED',
						message: e instanceof Error ? e.message : 'Authentication required'
					}
				},
				{ status, headers: noStore }
			)
		};
	}
}
