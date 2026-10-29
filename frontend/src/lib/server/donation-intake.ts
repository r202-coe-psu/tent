import { error, json } from '@sveltejs/kit';
import { adminRaw, requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import {
	hasCapabilityInShelter,
	hasStaffCapability,
	isShelterManager,
	SHELTER_MANAGER,
	WAREHOUSE_STAFF
} from '$lib/auth/roles';
import { resolveActiveShelter } from '$lib/server/active-shelter';
import type { PublicDonationDoc, ReceiveDonationInput } from '$lib/features/donations';
import type { CountedItem } from '$lib/features/operations/server';
import { isSupplyItem, type SupplyItem, CATALOG_DB } from '$lib/features/supply/server';
import {
	isItemMaster,
	itemMasterUnit,
	requiresExpiry,
	type ItemMaster
} from '$lib/features/catalog/server';
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

/** Capabilities that run warehouse intake in a shelter (SA aside). */
const WAREHOUSE_CAPABILITIES = [SHELTER_MANAGER, WAREHOUSE_STAFF] as const;

/**
 * Warehouse intake session gate — `warehouse_staff` (+ `shelter_manager` / SA), NOT
 * CouchDB `_admin`. Mirrors the CR-024 capability pattern (`requireKitchen`).
 *
 * This only proves the caller does warehouse work SOMEWHERE (#477). It says nothing about which
 * shelter: `caller.shelterCode` is the first `shelter:` role and must not be used to scope an
 * action. Resolve the shelter being worked on with {@link resolveWarehouseShelter} (lists,
 * walk-in) or check the donation's own shelter with {@link isInCallerScope} (per-donation routes).
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

/**
 * The shelter a warehouse request works in: `requested` (the client's selected shelter) when the
 * caller holds a warehouse capability THERE (403 otherwise); with none requested, the caller's
 * only shelter, or 400 when they belong to several. SA: `requested`, or `null` for "no shelter
 * chosen" (the route decides between every shelter and a 400).
 */
export function resolveWarehouseShelter(
	caller: Caller,
	requested: string | null | undefined
): string | null {
	return resolveActiveShelter(
		caller.roles,
		caller.isSA,
		requested,
		WAREHOUSE_CAPABILITIES,
		'Requires warehouse_staff or shelter_manager in this shelter, or system_admin'
	);
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

/**
 * Shelter-scope isolation: non-SA callers only touch donations of a shelter where they hold a
 * warehouse capability — the donation's own shelter is the active one (#477), so a user with
 * `warehouse_staff` in SH002 only is refused SH001's donations even when SH001 is their first
 * `shelter:` role.
 */
export function isInCallerScope(caller: Caller, donation: PublicDonationDoc): boolean {
	return (
		caller.isSA ||
		(!!donation.shelter_code &&
			WAREHOUSE_CAPABILITIES.some((cap) =>
				hasCapabilityInShelter(caller.roles, donation.shelter_code, cap)
			))
	);
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
 *
 * `shelterDbName` is the DB of the shelter receiving the goods: items it created itself
 * live there, not in `catalog`, and win over a central doc with the same id — the same
 * lookup as `loadCatalogItem` on the client receive path and `listItemMasters`.
 */
export async function assertCountedAgainstCatalog(
	counted: CountedItem[],
	shelterDbName: string
): Promise<void> {
	if (counted.length === 0) return;

	// Two shapes share the `catalog` database and the `_id` prefixes do not nest:
	// `item:{ulid}` is the T-10 supply stub (`unit`, `perishable`), `item_master:{ulid}`
	// the CR-013 master (`base_unit`; its expiry rule is derived — CR-143 FR-D1). Scanning only `item:` left
	// every item_master line rejected as an unknown item.
	const supplyItems = (await fetchDocs<SupplyItem>(CATALOG_DB, 'item:')).filter(isSupplyItem);
	const itemMasters = (await fetchDocs<ItemMaster>(CATALOG_DB, 'item_master:')).filter(
		isItemMaster
	);
	const shelterItemMasters = (await fetchDocs<ItemMaster>(shelterDbName, 'item_master:')).filter(
		isItemMaster
	);
	const byId = new Map<string, { unit: string; requiresExpiry: boolean }>([
		...supplyItems.map(
			(i) => [i._id, { unit: i.unit, requiresExpiry: requiresExpiry(i) }] as const
		),
		...[...itemMasters, ...shelterItemMasters].map(
			(m) => [m._id, { unit: itemMasterUnit(m), requiresExpiry: requiresExpiry(m) }] as const
		)
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
		if (item.requiresExpiry && !line.lot?.expiry) {
			throw new Error(`Perishable item ${line.item_id} requires lot.expiry to be set`);
		}
	}
}

/**
 * The booking staff decided on must still be the booking on file (CR-174, as FR-25 does
 * for the counter): the donor may edit a `pending_review` / `verifying` booking, and a
 * decision made on an older screen would land on lines nobody looked at. Returns the
 * refusal to send, or null when `body.expected_rev` is the doc's `_rev`.
 */
export function staleDecisionResponse(body: unknown, donation: { _rev?: string }) {
	const expected = (body as { expected_rev?: unknown } | null)?.expected_rev;
	if (typeof expected !== 'string' || !expected) {
		return json(
			{ success: false, error_code: 'REV_REQUIRED', error: 'expected_rev is required' },
			{ status: 422 }
		);
	}
	if (expected !== donation._rev) {
		return json(
			{
				success: false,
				error_code: 'DONATION_CHANGED',
				error: 'ผู้บริจาคแก้ใบนี้หลังจากเปิดหน้าไว้ — โหลดรายการใหม่แล้วตรวจอีกครั้ง'
			},
			{ status: 409 }
		);
	}
	return null;
}
