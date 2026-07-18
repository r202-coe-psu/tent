import { error } from '@sveltejs/kit';
import { requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import { isShelterManager } from '$lib/auth/roles';

/**
 * Shared helper to authorize a referral action (Shelter Manager or System Admin only).
 */
export async function authorizeReferral(cookie: string | null): Promise<Caller> {
	const caller = await requireShelterScopeOrSA(cookie);
	const allowed = caller.isSA || isShelterManager(caller.roles);
	if (!allowed) {
		throw error(403, 'Requires shelter_manager or system_admin role');
	}
	return caller;
}

/**
 * Shared helper to resolve the active shelter code.
 * Throws a 400 error if a System Admin fails to provide an explicit shelter_code,
 * or if a regular manager lacks a shelter scope.
 */
export function resolveShelterCode(caller: Caller, urlShelterCode: string | null): string {
	if (!caller.isSA) {
		if (!caller.shelterCode) throw error(400, 'Missing shelter_code scope');
		return caller.shelterCode;
	}
	if (!urlShelterCode) {
		throw error(400, 'SA must supply shelter_code parameter');
	}
	return urlShelterCode;
}
