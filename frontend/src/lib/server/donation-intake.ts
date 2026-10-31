import { error, json } from '@sveltejs/kit';
import { adminRaw, requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import { hasStaffCapability, isShelterManager } from '$lib/auth/roles';
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
	query: string,
	/** Limit the lookup to these shelters (a non-SA caller's own); default every shelter. */
	onlyShelters?: readonly string[]
): Promise<{ donation: PublicDonationDoc; dbName: string } | null> {
	const shelterCodes = onlyShelters ? [...onlyShelters] : await listShelterCodes();

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
 * The ONE shelter a "รับแล้ว" read is about (#821 FR-9a) — shared by the list
 * (`GET ?status=received`) and the search (`POST received/search`) so both answer alike.
 *
 * A CouchDB bookmark cannot span databases, and a masked list that mixed shelters would hide
 * which one a row belongs to, so the answer is exactly one shelter:
 * - system admin: must name it (400 without); it must be registered (404) — the code lands in
 *   a CouchDB path under admin credentials, so `x/../../_users` is not let through;
 * - everyone else: their own shelter; naming another one is a 403.
 *
 * Returns the code, or the `Response` to send back (400 / 404). A caller with no shelter at
 * all, or asking for another one, is thrown as a 403 like the rest of this surface.
 */
export async function resolveReceivedShelter(
	caller: Caller,
	requested: string | null | undefined
): Promise<{ code: string } | { response: Response }> {
	const wanted = requested?.trim() || null;
	if (caller.isSA) {
		if (!wanted) {
			return {
				response: json({ success: false, error: 'shelter is required' }, { status: 400 })
			};
		}
		if (!(await listShelterCodes()).includes(wanted)) {
			return { response: json({ success: false, error: 'Unknown shelter' }, { status: 404 }) };
		}
		return { code: wanted };
	}
	if (!caller.shelterCode) throw error(403, 'No shelter scope');
	if (wanted && wanted !== caller.shelterCode) throw error(403, 'Forbidden');
	return { code: caller.shelterCode };
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
