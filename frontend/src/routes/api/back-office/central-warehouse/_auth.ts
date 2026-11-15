import { error, json } from '@sveltejs/kit';
import { requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import { SHELTER_MANAGER, WAREHOUSE_STAFF, canAccessCentralWarehouse } from '$lib/auth/roles';
import { resolveActiveShelter } from '$lib/server/active-shelter';

/**
 * Shared helper to format and return standardized SvelteKit API endpoint error responses.
 * Mirrors `referral/_auth.ts`.
 */
export function handleEndpointError(e: unknown, label?: string) {
	void label;
	const err = e as { status?: number; body?: { message?: string }; message?: string };
	const status = err.status || 500;
	const message = err.body?.message || err.message || 'Internal Server Error';
	return json({ error: message }, { status });
}

/**
 * Authorize a central-warehouse (M6) action — draft CR M6 D2: system_admin, or `shelter_manager` /
 * `warehouse_staff` IN the shelter the request acts on (#477). `supply_coordinator` is NOT admitted
 * (unlike `authorizeTransfer`): the capability list is exactly these two.
 *
 * `requestedShelter` is the `?shelter_code=` the client sends (its selected shelter); it must be a
 * shelter where the capability is held. The returned caller's `shelterCode` IS the resolved active
 * shelter (SA: the requested one, or null when none was given), so {@link resolveShelterCode} agrees.
 */
export async function authorizeCentralWarehouse(
	cookie: string | null,
	requestedShelter: string | null
): Promise<Caller> {
	const caller = await requireShelterScopeOrSA(cookie);
	const message = 'Requires warehouse_staff, shelter_manager, or system_admin';
	if (!canAccessCentralWarehouse(caller.roles, null)) {
		throw error(403, message);
	}
	const active = resolveActiveShelter(
		caller.roles,
		caller.isSA,
		requestedShelter,
		[SHELTER_MANAGER, WAREHOUSE_STAFF],
		message
	);
	return { ...caller, shelterCode: active ?? caller.shelterCode };
}

/**
 * Resolve the active shelter code. 400 when a System Admin gives no `shelter_code`, or a regular
 * caller lacks a shelter scope.
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
