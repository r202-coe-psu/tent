import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import {
	assertCountedAgainstCatalog,
	authorizeWarehouse,
	findDonationByQuery,
	isInCallerScope,
	routeErrorResponse as toRouteError,
	toCountedItems
} from '$lib/server/donation-intake';
import {
	type PublicDonationDoc,
	type ScanDonationView,
	receiveDonationInputSchema
} from '$lib/features/donations';
import {
	keyDonationReceipt,
	type CountedItem,
	type Donation,
	type StockLedger
} from '$lib/features/operations/server';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';
import { allocateLotNos } from '$lib/server/lot-number';

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
		donor: {
			name: d.donor?.name ?? '',
			phone: d.donor?.phone ?? null,
			email: d.donor?.email ?? null
		},
		items: (d.items ?? []).map((it) => ({
			item_id: it.item_id,
			free_text: it.free_text,
			qty: it.qty,
			unit: it.unit
		})),
		logistics: d.logistics
	};
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

		/**
		 * `received` is the only status this route refuses, and that is deliberate: it
		 * does NOT gate on `canTransitionDonation`, so a `pending_review` booking can be
		 * received straight from the counter.
		 *
		 * Scanning the QR is a DATA-ENTRY shortcut, not a shortcut past review — staff
		 * still work the drop-off screen line by line (count, storage zone, "ผ่านการ
		 * ตรวจสอบแล้ว" per item) before this request is sent; the scan only saves them
		 * re-keying what the donor already declared, the way the walk-in form makes them
		 * type it. The verification is the counting, not an intermediate doc status.
		 *
		 * So do not "tighten" this into `canTransitionDonation(status, 'received')`:
		 * §2.3 has no `pending_review → received` edge and the whole scan flow would
		 * start answering 422. Adding that edge to the transition table is a schema.md
		 * change and needs a CR of its own.
		 */
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

		// Lot labels are minted here, not on the client: the per-day sequence needs
		// to see every row already on this shelter's ledger (CR-088 · schema.md §2.1).
		// One label per counted line, in the order the lines are keyed.
		const lotNos = await allocateLotNos(dbName, counted.length);
		const countedWithLots: CountedItem[] = counted.map((line, i) => ({
			...line,
			lot: { ...(line.lot ?? {}), lot_no: lotNos[i] }
		}));

		// 1) Ledger — the ONLY path from a donation into stock. Positive entries,
		//    reason `donation`, ref_id back to the donation (couchdb-mongodb-sync.md §4.2).
		const ledgers: StockLedger[] = keyDonationReceipt(
			donation as unknown as Donation,
			countedWithLots,
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
					lot_nos: lotNos,
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
			donation: toScanView(updated),
			// Staff label the physical boxes from this (CR-088) — `toScanView` is the
			// donation projection and has no room for per-ledger-row data.
			lots: ledgers.map((l) => ({ item_id: l.item_id, lot_no: l.lot?.lot_no ?? null }))
		});
	} catch (e) {
		return routeErrorResponse(e);
	}
};
