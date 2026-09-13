import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	assertCountedAgainstCatalog,
	authorizeWarehouse,
	listShelterCodes,
	routeErrorResponse,
	shelterDb,
	toCountedItems
} from '$lib/server/donation-intake';
import { fetchDocs } from '$lib/server/donation-docs';
import { adminRaw } from '$lib/server/couch-admin';
import {
	walkInIntakeInputSchema,
	type PublicDonationDoc,
	type PendingDonationRow
} from '$lib/features/donations';
import {
	createWalkInDonation,
	keyDonationReceipt,
	receiveDonation,
	type CountedItem,
	type Donation,
	type StockLedger
} from '$lib/features/operations/server';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';
import { allocateLotNos } from '$lib/server/lot-number';
import { sha256Hex } from '$lib/db/hash';

/**
 * Pending intake queue — the pre-declared donations a shelter is still waiting on
 * (T-16-1.1). Shelter-scoped: staff see only their own shelter, SA sees every shelter.
 *
 * Rows are redacted the same way the scan station's `ScanDonationView` is: no
 * `tracking_token_hash`, no `phone_hash`, no `_rev`. Donor `phone` is included —
 * warehouse staff need it to chase a late delivery.
 */
function toPendingRow(d: PublicDonationDoc): PendingDonationRow {
	const items = d.items ?? [];
	const itemNotes = items.map((it) => it.note?.trim()).filter((n): n is string => Boolean(n));
	const donorNote = itemNotes.length > 0 ? itemNotes.join('\n') : null;
	const isUnsolicited = items.length === 0 || items.some((it) => !it.item_id);

	return {
		booking_ref: d.booking_ref,
		donation_id: d._id,
		shelter_code: d.shelter_code,
		status: d.status,
		donor_name: d.donor?.name ?? '',
		donor_phone: d.donor?.phone ?? null,
		donor_email: d.donor?.email ?? null,
		item_count: items.length,
		items: items.map((it) => ({
			item_id: it.item_id,
			free_text: it.free_text,
			category: it.category,
			qty: it.qty,
			unit: it.unit,
			condition: it.condition,
			note: it.note
		})),
		declared_at: d.declared_at,
		eta: d.logistics?.eta,
		slot: d.logistics?.slot,
		delivery_method: d.logistics?.delivery_method,
		vehicle: d.logistics?.vehicle ?? null,
		pickup_address: d.logistics?.pickup_address ?? null,
		donor_note: donorNote,
		is_unsolicited: isUnsolicited
	};
}

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));
		const status = url.searchParams.get('status') ?? 'declared';

		// Scope first, then read: a non-SA caller never reaches another shelter's db.
		const codes = caller.isSA
			? await listShelterCodes()
			: caller.shelterCode
				? [caller.shelterCode]
				: [];

		const rows: PendingDonationRow[] = [];
		for (const code of codes) {
			const donations = await fetchDocs<PublicDonationDoc>(shelterDb(code), 'donation:');
			for (const d of donations) {
				if (d?.type === 'donation' && d.status === status) rows.push(toPendingRow(d));
			}
		}

		// Soonest expected arrival first; undated bookings sink to the bottom.
		rows.sort((a, b) =>
			(a.eta ?? a.declared_at ?? '9999-99-99').localeCompare(b.eta ?? b.declared_at ?? '9999-99-99')
		);

		return json({ success: true, donations: rows });
	} catch (e) {
		const { message, status: code } = routeErrorResponse(e);
		return json({ success: false, error: message }, { status: code });
	}
};

/**
 * Counter walk-in intake — declare AND receive in one request.
 *
 * The scan station used to mint the `donation` + `stock_ledger` docs in the browser
 * and `bulkDocs` them straight into CouchDB. That skipped everything this route does:
 * the catalog/unit guard, the server-side lot sequence (CR-088), the audit entry
 * (T-16/FR-33), and — because the client wrote the donation as `declared` next to its
 * own ledger rows — it double-counted the goods against the campaign's needs
 * (outstanding donation + on-hand stock for one delivery).
 *
 * Written as ONE `_bulk_docs`: every doc is brand new with a fresh ulid, so there is
 * no conflict to lose a race to, and a half-written receipt (stock with no donation to
 * reconcile it against, or a locked donation whose goods never reached the ledger) is
 * the one outcome worth ruling out.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));

		const parsed = walkInIntakeInputSchema.safeParse(await request.json());
		if (!parsed.success) {
			return json(
				{
					success: false,
					error_code: 'INVALID_INPUT',
					error: 'Invalid input',
					details: parsed.error.flatten()
				},
				{ status: 422 }
			);
		}
		const input = parsed.data;

		// Scope: staff key donations for their own shelter; SA has none of their own and
		// must name one that exists.
		let shelterCode = caller.shelterCode ?? '';
		if (caller.isSA) {
			if (!input.shelter_code) {
				return json(
					{ success: false, error_code: 'SHELTER_REQUIRED', error: 'shelter_code is required' },
					{ status: 400 }
				);
			}
			const codes = await listShelterCodes();
			if (!codes.includes(input.shelter_code)) {
				return json(
					{ success: false, error_code: 'SHELTER_NOT_FOUND', error: 'Unknown shelter_code' },
					{ status: 404 }
				);
			}
			shelterCode = input.shelter_code;
		}
		if (!shelterCode) {
			return json(
				{ success: false, error_code: 'SHELTER_REQUIRED', error: 'Caller has no shelter scope' },
				{ status: 400 }
			);
		}

		const counted = toCountedItems(
			input.items.map((it) => ({
				item_id: it.item_id,
				qty: it.qty,
				unit: it.unit,
				...(it.lot ? { lot: it.lot } : {})
			}))
		);
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

		const dbName = shelterDb(shelterCode);
		const ctx = { shelterCode, createdBy: caller.name };
		const phone = input.donor.phone?.trim() || null;

		// A walk-in has no donor-facing token; the hash still has to be opaque and
		// unique, so it comes from a random value rather than anything guessable.
		const declared = createWalkInDonation(
			{
				donor: {
					name: input.donor.name,
					phone,
					phone_hash: await sha256Hex(phone ?? `walk-in:${crypto.randomUUID()}`)
				},
				kind: 'items',
				items: input.items.map((it) => ({ item_id: it.item_id, qty: it.qty, unit: it.unit })),
				tracking_token_hash: await sha256Hex(crypto.randomUUID())
			},
			ctx
		);

		const lotNos = await allocateLotNos(dbName, counted.length);
		const countedWithLots: CountedItem[] = counted.map((line, i) => ({
			...line,
			lot: { ...(line.lot ?? {}), lot_no: lotNos[i] }
		}));
		const ledgers: StockLedger[] = keyDonationReceipt(declared, countedWithLots, ctx);

		// `receiveDonation` is the only thing that moves the lifecycle, so the walk-in
		// edge (`declared → received`) stays defined in one place (schema.md §2.3).
		const received: Donation = receiveDonation(declared);
		const donationDoc = {
			...received,
			...(input.donor.email ? { donor: { ...received.donor, email: input.donor.email } } : {}),
			received_summary: {
				total_items: input.items.length,
				received_at: received.received_at ?? new Date().toISOString(),
				...(input.remarks ? { remarks: input.remarks } : {})
			}
		};

		const audit: AuditEntry = createAuditEntry(
			{
				action: 'manual_adjust',
				target_type: 'donation',
				target_id: declared._id,
				reason: `รับบริจาค walk-in ที่หน้าเคาน์เตอร์ (${declared.booking_ref ?? declared._id})`,
				context: {
					booking_ref: declared.booking_ref ?? null,
					received_by: caller.name,
					// Walk-in has no separate declaration to diverge from: what staff
					// counted IS what was declared.
					received_items: input.items.map((it) => ({
						item_id: it.item_id,
						free_text: null,
						qty: it.qty,
						unit: it.unit
					})),
					has_discrepancy: false,
					ledger_ids: ledgers.map((l) => l._id),
					lot_nos: lotNos
				}
			},
			ctx
		);

		const writeRes = await adminRaw(`/${dbName}/_bulk_docs`, 'POST', {
			docs: [donationDoc, ...ledgers, audit]
		});
		if (writeRes.status >= 400) {
			throw new Error(`Failed to write walk-in donation: ${JSON.stringify(writeRes.data)}`);
		}
		const rows = (writeRes.data as Array<{ ok?: boolean; error?: string }>) ?? [];
		const failed = rows.filter((r) => !r.ok);
		if (failed.length > 0) {
			throw new Error(`Walk-in donation partially written: ${JSON.stringify(failed)}`);
		}

		return json({
			success: true,
			booking_ref: declared.booking_ref ?? null,
			donation_id: declared._id,
			// Staff label the physical boxes from these (CR-088).
			lots: ledgers.map((l) => ({ item_id: l.item_id, lot_no: l.lot?.lot_no ?? null }))
		});
	} catch (e) {
		const { message, status: code } = routeErrorResponse(e);
		return json({ success: false, error: message }, { status: code });
	}
};
