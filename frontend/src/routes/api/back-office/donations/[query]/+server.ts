import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import {
	authorizeWarehouse,
	findDonationByQuery,
	isInCallerScope,
	routeErrorResponse as toRouteError
} from '$lib/server/donation-intake';
import {
	type PublicDonationDoc,
	type ScanDonationView,
	type ReceiveDonationInput,
	receiveDonationInputSchema
} from '$lib/features/donations';
import {
	keyDonationReceipt,
	type CountedItem,
	type Donation,
	type StockLedger
} from '$lib/features/operations/server';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';
import { isSupplyItem, type SupplyItem, CATALOG_DB } from '$lib/features/supply/server';
import { fetchDocs } from '$lib/server/donation-docs';

function routeErrorResponse(e: unknown) {
	const { message, status } = toRouteError(e);
	return json({ success: false, error: message }, { status });
}

// Project a raw donation doc to the redacted view the scan UI needs (no _rev,
// tracking_token_hash, phone_hash, timestamps). Full phone kept for warehouse staff.
function toScanView(d: PublicDonationDoc): ScanDonationView {
	return {
		booking_ref: d.booking_ref,
		shelter_code: d.shelter_code,
		status: d.status,
		donor: { name: d.donor?.name ?? '', phone: d.donor?.phone ?? null },
		items: (d.items ?? []).map((it) => ({
			item_id: it.item_id,
			free_text: it.free_text,
			qty: it.qty,
			unit: it.unit
		})),
		logistics: d.logistics
	};
}

/**
 * A counted line that becomes stock. Only lines carrying an `item_id` qualify:
 * `stock_ledger.item_id` must point at a real catalog item and `unit` must equal
 * that item's `base_unit` (schema.md §2.1), so free-text donations stay on the
 * donation doc and never reach the ledger.
 */
function toCountedItems(lines: ReceiveDonationInput['items']): CountedItem[] {
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
async function assertCountedAgainstCatalog(counted: CountedItem[]): Promise<void> {
	if (counted.length === 0) return;
	const items = (await fetchDocs<SupplyItem>(CATALOG_DB, 'item:')).filter(isSupplyItem);
	const byId = new Map(items.map((i) => [i._id, i]));

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

export const GET: RequestHandler = async ({ params, request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));
		const { query } = params;
		if (!query) {
			return json({ success: false, error: 'Query parameter is required' }, { status: 400 });
		}

		const found = await findDonationByQuery(query);
		if (!found) {
			return json({ success: false, error: 'Donation not found' }, { status: 404 });
		}

		// Shelter-scope isolation: non-SA callers may only see donations of their own shelter.
		if (!isInCallerScope(caller, found.donation)) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		return json({
			success: true,
			donation: toScanView(found.donation)
		});
	} catch (e) {
		return routeErrorResponse(e);
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));
		const { query } = params;
		if (!query) {
			return json({ success: false, error: 'Query parameter is required' }, { status: 400 });
		}

		const found = await findDonationByQuery(query);
		if (!found) {
			return json({ success: false, error: 'Donation not found' }, { status: 404 });
		}

		// Shelter-scope isolation: non-SA callers may only receive donations of their own shelter.
		if (!isInCallerScope(caller, found.donation)) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		const body = await request.json();
		const parsed = receiveDonationInputSchema.safeParse(body);
		if (!parsed.success) {
			return json(
				{ success: false, error: 'Invalid input', details: parsed.error.flatten() },
				{ status: 422 }
			);
		}

		const { donation, dbName } = found;

		if (donation.status === 'received') {
			return json(
				{ success: false, error: 'Donation is already received (LOCKED)' },
				{ status: 400 }
			);
		}

		// What staff actually counted; falls back to the declared lines when the
		// UI sends none (walk-through with nothing changed).
		const countedLines = parsed.data.items ?? donation.items;
		const counted = toCountedItems(countedLines);

		try {
			await assertCountedAgainstCatalog(counted);
		} catch (e) {
			return json(
				{
					success: false,
					error_code: 'CATALOG_MISMATCH',
					error: e instanceof Error ? e.message : 'Invalid counted items'
				},
				{ status: 422 }
			);
		}

		const ctx = { shelterCode: donation.shelter_code, createdBy: caller.name };

		// 1) Ledger — the ONLY path from a donation into stock. Positive entries,
		//    reason `donation`, ref_id back to the donation (couchdb-mongodb-sync.md §4.2).
		const ledgers: StockLedger[] = keyDonationReceipt(
			donation as unknown as Donation,
			counted,
			ctx
		);

		// 2) Audit — who received what, from which booking, declared vs actual.
		//    No donor PII in `context`: the booking ref is the donor-facing handle.
		const declaredSnapshot = (donation.items ?? []).map((it) => ({
			item_id: it.item_id ?? null,
			free_text: it.free_text ?? null,
			qty: it.qty,
			unit: it.unit
		}));
		const receivedSnapshot = (countedLines ?? []).map((it) => ({
			item_id: it.item_id ?? null,
			free_text: it.free_text ?? null,
			qty: it.qty,
			unit: it.unit
		}));
		const audit: AuditEntry = createAuditEntry(
			{
				action: 'manual_adjust',
				target_type: 'donation',
				target_id: donation._id,
				reason: `ตรวจรับบริจาคที่ศูนย์ (${donation.booking_ref ?? donation._id})`,
				context: {
					booking_ref: donation.booking_ref ?? null,
					received_by: caller.name,
					declared_items: declaredSnapshot,
					received_items: receivedSnapshot,
					has_discrepancy: JSON.stringify(declaredSnapshot) !== JSON.stringify(receivedSnapshot),
					ledger_ids: ledgers.map((l) => l._id),
					free_text_lines_skipped: (countedLines ?? []).length - counted.length
				}
			},
			ctx
		);

		// Ledger + audit go in FIRST. If this fails the donation stays `declared`
		// and staff can key it again — safer than a received donation whose goods
		// never reached the ledger.
		const appendRes = await adminRaw(`/${dbName}/_bulk_docs`, 'POST', {
			docs: [...ledgers, audit]
		});
		if (appendRes.status >= 400) {
			throw new Error(
				`Failed to write stock ledger / audit trail: ${JSON.stringify(appendRes.data)}`
			);
		}

		const nowStr = new Date().toISOString();
		// 3) Donation stays the record of what was DECLARED — `items` is never
		//    overwritten (the projector mirrors it as `items_declared`). What was
		//    actually received lands on `received_summary` (couchdb-mongodb-sync.md §3.2).
		const updated: PublicDonationDoc = {
			...donation,
			status: 'received',
			received_at: nowStr,
			updated_at: nowStr,
			received_summary: {
				total_items: (countedLines ?? []).length,
				received_at: nowStr,
				...(parsed.data.remarks ? { remarks: parsed.data.remarks } : {})
			}
		};

		const saveRes = await adminRaw(`/${dbName}/${donation._id}`, 'PUT', updated);
		if (saveRes.status === 409) {
			return json(
				{
					success: false,
					error: 'Donation was updated by another process. Please search again and retry.'
				},
				{ status: 409 }
			);
		}
		if (saveRes.status >= 400) {
			throw new Error(`Failed to update donation to CouchDB: ${JSON.stringify(saveRes.data)}`);
		}

		return json({
			success: true,
			donation: toScanView(updated)
		});
	} catch (e) {
		return routeErrorResponse(e);
	}
};
