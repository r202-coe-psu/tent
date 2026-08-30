import { error, json } from '@sveltejs/kit';
import { authorizeWarehouse } from '$lib/server/donation-intake';
import type { Caller } from '$lib/server/couch-admin';

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
 * Shared helper to authorize a transfer action — reuses `authorizeWarehouse`
 * (`$lib/server/donation-intake.ts`), the existing INVENTORY_WRITE_ROLES gate
 * (`system_admin`/`shelter_manager`/`warehouse_staff`, role-permission-matrix.md FR-30).
 */
export async function authorizeTransfer(cookie: string | null): Promise<Caller> {
	return authorizeWarehouse(cookie);
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
