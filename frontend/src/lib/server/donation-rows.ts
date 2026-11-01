import type { PendingDonationRow, PublicDonationDoc } from '$lib/features/donations/server';
import { maskDonorEmail, maskDonorName, maskDonorPhone } from '$lib/features/donations/server';

/**
 * Rows of the back-office donation lists. Server-only; lives here rather than in a route
 * because a `+server.ts` may only export HTTP handlers, and the list and the "รับแล้ว"
 * search must build the same row.
 */

/**
 * Pending intake queue — the pre-declared donations a shelter is still waiting on
 * (T-16-1.1). Shelter-scoped: staff see only their own shelter, SA sees every shelter.
 *
 * Rows are redacted the same way the scan station's `ScanDonationView` is: no
 * `tracking_token_hash`, no `phone_hash`. Donor `phone` is included — warehouse staff
 * need it to chase a late delivery. `rev` goes back with a review decision, so one made
 * on a booking the donor has since edited is refused (CR-174).
 */
export function toPendingRow(d: PublicDonationDoc): PendingDonationRow {
	const items = d.items ?? [];
	const itemNotes = items.map((it) => it.note?.trim()).filter((n): n is string => Boolean(n));
	const donorNote = itemNotes.length > 0 ? itemNotes.join('\n') : null;
	const isUnsolicited = items.length === 0 || items.some((it) => !it.item_id);

	return {
		rev: d._rev,
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
			note: it.note,
			review_status: it.review_status,
			review_reason: it.review_reason ?? null,
			reserved_qty: it.reserved_qty,
			drop_off_point_id: it.drop_off_point_id ?? null
		})),
		campaign_id: d.campaign_id ?? null,
		declared_at: d.declared_at,
		received_at: d.received_at ?? null,
		eta: d.logistics?.eta,
		slot: d.logistics?.slot,
		delivery_method: d.logistics?.delivery_method,
		vehicle: d.logistics?.vehicle ?? null,
		vehicle_plate: d.logistics?.vehicle_plate ?? null,
		pickup_address: d.logistics?.pickup_address ?? null,
		donor_note: donorNote,
		is_unsolicited: isUnsolicited,
		photos: d.photos ?? []
	};
}

/**
 * A row of the "รับแล้ว" list (#821 FR-10): the same row, with the donor's contact masked
 * HERE, before it leaves the server — a mask applied on screen would still leave the full
 * name, number and email in the response for anyone with DevTools. The full values come one
 * donation at a time from `POST [query]/contact`, which writes an audit row.
 */
export function toReceivedRow(d: PublicDonationDoc): PendingDonationRow {
	const row = toPendingRow(d);
	return {
		...row,
		donor_name: maskDonorName(d.donor?.name),
		donor_phone: d.donor?.phone ? maskDonorPhone(d.donor.phone) : null,
		donor_email: d.donor?.email ? maskDonorEmail(d.donor.email) : null,
		contact_masked: true,
		...receivedItemsOf(d)
	};
}

/** The received lines of a donation, or nothing when the doc predates `received_summary.items`. */
function receivedItemsOf(d: PublicDonationDoc): Pick<PendingDonationRow, 'received_items'> {
	const lines = d.received_summary?.items;
	if (!Array.isArray(lines)) return {};
	const declaredUnit = new Map(
		(d.items ?? []).map((it) => [it.item_id ?? it.free_text ?? '', it.unit])
	);
	return {
		received_items: lines
			.filter((line) => !line.rejected)
			.map((line) => ({
				item_id: line.item_id,
				free_text: line.free_text,
				qty: line.qty,
				unit: line.unit ?? declaredUnit.get(line.item_id ?? line.free_text ?? '') ?? ''
			}))
	};
}
