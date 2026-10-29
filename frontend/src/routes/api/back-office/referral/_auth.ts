import { error, json } from '@sveltejs/kit';
import { requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import { isShelterManager, SHELTER_MANAGER } from '$lib/auth/roles';
import { resolveActiveShelter } from '$lib/server/active-shelter';

/**
 * Shared helper to format, log, and return standardized SvelteKit API endpoint error responses.
 */
export function handleEndpointError(e: unknown, label?: string) {
	void label;
	const err = e as { status?: number; body?: { message?: string }; message?: string };
	const status = err.status || 500;
	const message = err.body?.message || err.message || 'Internal Server Error';
	return json({ error: message }, { status });
}

/**
 * Shared helper to authorize a referral action: system_admin, or `shelter_manager` IN the shelter
 * the request acts on (#477). `requestedShelter` is the `?shelter_code=` the client sends (its
 * selected shelter); a manager of SH002 only is refused for SH001, and a multi-shelter manager
 * picks which shelter they work in instead of being pinned to the first `shelter:` role.
 *
 * The returned caller's `shelterCode` IS the resolved active shelter (SA: the requested one, or
 * null when none was given), so {@link resolveShelterCode} and every downstream read of it agree.
 */
export async function authorizeReferral(
	cookie: string | null,
	requestedShelter: string | null
): Promise<Caller> {
	const caller = await requireShelterScopeOrSA(cookie);
	if (!caller.isSA && !isShelterManager(caller.roles)) {
		throw error(403, 'Requires shelter_manager or system_admin role');
	}
	const active = resolveActiveShelter(
		caller.roles,
		caller.isSA,
		requestedShelter,
		[SHELTER_MANAGER],
		'Requires shelter_manager in this shelter or system_admin role'
	);
	return { ...caller, shelterCode: active ?? caller.shelterCode };
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
