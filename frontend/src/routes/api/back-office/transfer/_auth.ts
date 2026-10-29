import { error, json } from '@sveltejs/kit';
import { requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import {
	isShelterManager,
	isWarehouseStaff,
	SHELTER_MANAGER,
	SUPPLY_COORDINATOR,
	WAREHOUSE_STAFF
} from '$lib/auth/roles';
import { resolveActiveShelter } from '$lib/server/active-shelter';

/**
 * Shared helper to format, log, and return standardized SvelteKit API endpoint error responses.
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
 * Shared helper to authorize a transfer action: system_admin, or — in the shelter the request
 * acts on — shelter_manager or the warehouse side of that shelter: `warehouse_staff` or
 * `supply_coordinator` (#571, #477).
 *
 * `requestedShelter` is the `?shelter_code=` the client sends (its selected shelter). The
 * capability is checked IN that shelter, not "any shelter": a user who is supply_coordinator in
 * SH002 but only registration_staff in SH001 must not act on SH001's transfers, and a user of
 * several shelters picks which one they work in rather than being pinned to the first
 * `shelter:` role. role-permission-matrix.md gives SC the Inventory & Supply row at shelter
 * scope, and its decision sync 2026-10-10 note makes `warehouse_staff` an alias of SC
 * (docs/prd/role-permission-matrix.md, "พัสดุและคลัง").
 *
 * The returned caller's `shelterCode` IS the resolved active shelter (SA: the requested one, or
 * null when none was given), so {@link resolveShelterCode} agrees with it.
 */
export async function authorizeTransfer(
	cookie: string | null,
	requestedShelter: string | null
): Promise<Caller> {
	const caller = await requireShelterScopeOrSA(cookie);
	const message = 'Requires warehouse_staff, supply_coordinator, shelter_manager, or system_admin';
	if (!caller.isSA && !isShelterManager(caller.roles) && !isWarehouseStaff(caller.roles)) {
		throw error(403, message);
	}
	const active = resolveActiveShelter(
		caller.roles,
		caller.isSA,
		requestedShelter,
		[SHELTER_MANAGER, WAREHOUSE_STAFF, SUPPLY_COORDINATOR],
		message
	);
	return { ...caller, shelterCode: active ?? caller.shelterCode };
}

/**
 * Shared helper to resolve the active shelter code.
 * Throws a 400 error if a System Admin fails to provide an explicit shelter_code,
 * or if a regular caller lacks a shelter scope.
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
