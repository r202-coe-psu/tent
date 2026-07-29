import { error } from '@sveltejs/kit';
import { adminRaw, requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import { hasStaffCapability, isShelterManager } from '$lib/auth/roles';
import type { PublicDonationDoc } from '$lib/features/donations';
import { fetchDocs } from '$lib/server/donation-docs';
import { sha256Hex } from '$lib/db/hash';

/**
 * Shared server helpers for the back-office donation intake surface (T-16).
 *
 * **Server-only** (admin credentials) — shared by the scan/receive route and the
 * audit-trail read route so both enforce the same gate and lookup.
 */

type RegistryRow = { id: string; doc?: { code?: string } };
type RegistryAllDocs = { rows?: RegistryRow[] };

/**
 * Warehouse intake gate — `warehouse_staff` (+ `shelter_manager` / SA), NOT
 * CouchDB `_admin`. Mirrors the CR-024 capability pattern (`requireKitchen`).
 */
export async function authorizeWarehouse(cookie: string | null): Promise<Caller> {
	const caller = await requireShelterScopeOrSA(cookie); // authenticated; resolves roles/scope
	const allowed =
		caller.isSA ||
		isShelterManager(caller.roles) ||
		hasStaffCapability(caller.roles, 'warehouse_staff');
	if (!allowed) throw error(403, 'Requires warehouse_staff, shelter_manager, or system_admin');
	return caller;
}

/** Every shelter code in the registry (`shelter:{ulid}` docs carry `code`). */
export async function listShelterCodes(): Promise<string[]> {
	const resRegistry = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
	if (resRegistry.status >= 400) {
		throw new Error('Could not read registry');
	}
	const registryRows = (resRegistry.data as RegistryAllDocs)?.rows ?? [];
	return registryRows
		.filter((r) => r.id.startsWith('shelter:') && r.doc?.code)
		.map((r) => r.doc!.code as string);
}

/** `shelter_{code}` — the per-shelter CouchDB name. */
export function shelterDb(code: string): string {
	return `shelter_${code.toLowerCase()}`;
}

/**
 * Find a donation across all shelters by `booking_ref` or `tracking_token`.
 * Uses an `_all_docs` scan (no Mango index required — same pattern as the public
 * tracking lookup). The raw token is never stored, so it is hashed before compare.
 */
export async function findDonationByQuery(
	query: string
): Promise<{ donation: PublicDonationDoc; dbName: string } | null> {
	const shelterCodes = await listShelterCodes();

	const tokenHash = await sha256Hex(query);

	for (const code of shelterCodes) {
		const dbName = shelterDb(code);
		const donations = await fetchDocs<PublicDonationDoc>(dbName, 'donation:');
		const match = donations.find(
			(d) =>
				d?.type === 'donation' && (d.booking_ref === query || d.tracking_token_hash === tokenHash)
		);
		if (match) return { donation: match, dbName };
	}
	return null;
}

/** Shelter-scope isolation: non-SA callers only touch their own shelter's donations. */
export function isInCallerScope(caller: Caller, donation: PublicDonationDoc): boolean {
	return caller.isSA || caller.shelterCode === donation.shelter_code;
}

/** Render a thrown value as the `{ success: false, error }` shape this surface uses. */
export function routeErrorResponse(e: unknown): { message: string; status: number } {
	const message = e instanceof Error ? e.message : 'Internal Server Error';
	const status =
		typeof e === 'object' &&
		e !== null &&
		'status' in e &&
		typeof (e as { status: unknown }).status === 'number'
			? (e as { status: number }).status
			: 500;
	return { message: message || 'Internal Server Error', status };
}
