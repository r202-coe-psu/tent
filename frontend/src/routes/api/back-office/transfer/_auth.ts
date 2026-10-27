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
 * Shared helper to authorize a transfer action: system_admin, or — in the caller's own shelter,
 * the one every transfer route acts on — shelter_manager or the warehouse side of that shelter:
 * `warehouse_staff` or `supply_coordinator` (#571).
 *
 * The capability is checked against `caller.shelterCode`, not "any shelter": a user who is
 * supply_coordinator in SH002 but only registration_staff in SH001 must not act on SH001's
 * transfers. role-permission-matrix.md gives SC the Inventory & Supply row at shelter scope, and
 * its decision sync 2026-10-10 note makes `warehouse_staff` an alias of SC
 * (docs/prd/role-permission-matrix.md, "พัสดุและคลัง"). `authorizeWarehouse` (donation intake and
 * others) is unchanged; its any-shelter check is #477.
 */
export async function authorizeTransfer(cookie: string | null): Promise<Caller> {
	const caller = await requireShelterScopeOrSA(cookie);
	const code = caller.shelterCode;
	const allowed =
		caller.isSA ||
		(!!code && (isShelterManager(caller.roles, code) || isWarehouseStaff(caller.roles, code)));
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
