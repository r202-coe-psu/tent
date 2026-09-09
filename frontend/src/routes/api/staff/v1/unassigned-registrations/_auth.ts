/**
 * Shared staff gate for Unassigned Registration BFF routes (search + claim).
 * Server-only — not exported from the feature barrel.
 *
 * Search is wider than claim (#251 grill): any shelter-scoped staff (or SA) may
 * search the central pool for anti-dupe. Claim stays registration-desk gated.
 */
import { json } from '@sveltejs/kit';
import { canAccessUnassignedRegistrationQueue } from '$lib/auth/roles';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';

const noStore = { 'Cache-Control': 'no-store' };

export type UnassignedRegistrationAuthResult = { ok: true } | { ok: false; response: Response };

function authFailure(e: unknown): Response {
	const status =
		typeof e === 'object' && e !== null && 'status' in e && typeof e.status === 'number'
			? e.status
			: 401;
	return json(
		{
			error: {
				code: status === 403 ? 'FORBIDDEN' : 'UNAUTHENTICATED',
				message: e instanceof Error ? e.message : 'Authentication required'
			}
		},
		{ status, headers: noStore }
	);
}

/**
 * Federated intake search — SA or any shelter-scoped authenticated staff.
 * Does **not** require registration_staff (claim CTA is gated separately).
 */
export async function requireUnassignedRegistrationSearchAccess(
	cookie: string | null
): Promise<UnassignedRegistrationAuthResult> {
	try {
		const caller = await requireShelterScopeOrSA(cookie);
		if (!caller.isSA && !caller.shelterCode) {
			return {
				ok: false,
				response: json(
					{ error: { code: 'FORBIDDEN', message: 'Requires shelter-scoped staff' } },
					{ status: 403, headers: noStore }
				)
			};
		}
		return { ok: true };
	} catch (e) {
		return { ok: false, response: authFailure(e) };
	}
}

/**
 * Claim / queue desk — SA / shelter_manager / registration_staff.
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
		return { ok: false, response: authFailure(e) };
	}
}
