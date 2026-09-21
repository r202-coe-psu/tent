import { error } from '@sveltejs/kit';
import { adminRaw, requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import { hasStaffCapability, isShelterManager } from '$lib/auth/roles';
import type { PublicDonationDoc, ReceiveDonationInput } from '$lib/features/donations';
import type { CountedItem } from '$lib/features/operations/server';
import { isSupplyItem, type SupplyItem, CATALOG_DB } from '$lib/features/supply/server';
import { isItemMaster, itemMasterUnit, type ItemMaster } from '$lib/features/catalog/server';
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
 * Find a donation across all shelters by `booking_ref`, `tracking_token`, or doc `_id`.
 * Uses an `_all_docs` scan (no Mango index required — same pattern as the public
 * tracking lookup). The raw token is never stored, so it is hashed before compare.
 *
 * The `_id` form is what makes a **walk-in** reachable: `booking_ref` (`DN-######`) is
 * minted by FastAPI for public bookings only, so a donation keyed at the counter has
 * none — and every back-office action addresses a donation through this lookup. Without
 * it those donations could be listed but never opened, approved, or received.
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
				d?.type === 'donation' &&
				(d.booking_ref === query || d._id === query || d.tracking_token_hash === tokenHash)
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

/**
 * A counted line that becomes stock. Only lines carrying an `item_id` qualify:
 * `stock_ledger.item_id` must point at a real catalog item and `unit` must equal
 * that item's `base_unit` (schema.md §2.1), so free-text donations stay on the
 * donation doc and never reach the ledger.
 */
export function toCountedItems(lines: ReceiveDonationInput['items']): CountedItem[] {
	return (lines ?? [])
		.filter((it): it is typeof it & { item_id: string } => !!it.item_id)
		.map((it) => ({
			item_id: it.item_id,
			qty: it.qty,
			unit: it.unit,
			...(it.lot ? { lot: it.lot } : {})
		}));
}

/**
 * Enforce the catalog invariants the client-side receive path already enforces
 * (`assertReceiveAgainstCatalog`) — this route writes with admin credentials, so
 * `validate_doc_update` does not run for it and the checks must happen here.
 */
export async function assertCountedAgainstCatalog(counted: CountedItem[]): Promise<void> {
	if (counted.length === 0) return;

	// Two shapes share the `catalog` database and the `_id` prefixes do not nest:
	// `item:{ulid}` is the T-10 supply stub (`unit`, `perishable`), `item_master:{ulid}`
	// the CR-013 master (`base_unit`, no perishable flag). Scanning only `item:` left
	// every item_master line rejected as an unknown item.
	const supplyItems = (await fetchDocs<SupplyItem>(CATALOG_DB, 'item:')).filter(isSupplyItem);
	const itemMasters = (await fetchDocs<ItemMaster>(CATALOG_DB, 'item_master:')).filter(
		isItemMaster
	);
	const byId = new Map<string, { unit: string; perishable: boolean }>([
		...supplyItems.map((i) => [i._id, { unit: i.unit, perishable: i.perishable }] as const),
		...itemMasters.map((m) => [m._id, { unit: itemMasterUnit(m), perishable: false }] as const)
	]);

	for (const line of counted) {
		const item = byId.get(line.item_id);
		if (!item) {
			throw new Error(`Unknown item: ${line.item_id} — item must exist in the catalog`);
		}
		if (item.unit !== line.unit) {
			throw new Error(
				`Unit mismatch for item ${line.item_id}: expected ${item.unit}, got ${line.unit}`
			);
		}
		if (item.perishable && !line.lot?.expiry) {
			throw new Error(`Perishable item ${line.item_id} requires lot.expiry to be set`);
		}
	}
}
