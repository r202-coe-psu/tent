import { error, json } from '@sveltejs/kit';
import { requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import { isShelterManager, isWarehouseStaff } from '$lib/auth/roles';

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
 * Shared helper to authorize a transfer action: system_admin, shelter_manager, or the
 * warehouse side of a shelter — `warehouse_staff` or `supply_coordinator`.
 *
 * `isWarehouseStaff()` is the same predicate the supply page guard (`requireWarehouseAccess`)
 * uses, so a role that can open the transfer tab can also read and act on transfers (#571).
 * role-permission-matrix.md gives SC the Inventory & Supply row at shelter scope, and the
 * 2026-10-10 decision sync makes `warehouse_staff` an alias of SC. `authorizeWarehouse`
 * (donation intake and others) is unchanged.
 */
export async function authorizeTransfer(cookie: string | null): Promise<Caller> {
	const caller = await requireShelterScopeOrSA(cookie);
	const allowed = caller.isSA || isShelterManager(caller.roles) || isWarehouseStaff(caller.roles);
	if (!allowed) {
		throw error(
			403,
			'Requires warehouse_staff, supply_coordinator, shelter_manager, or system_admin'
		);
	}
	return caller;
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
