import { error } from '@sveltejs/kit';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { isShelterManager } from '$lib/auth/roles';

/**
 * Shared helper to authorize a referral action (Shelter Manager or System Admin only).
 */
export async function authorizeReferral(cookie: string | null) {
	const caller = await requireShelterScopeOrSA(cookie);
	const allowed = caller.isSA || isShelterManager(caller.roles);
	if (!allowed) {
		throw error(403, 'Requires shelter_manager or system_admin role');
	}
	return caller;
}
