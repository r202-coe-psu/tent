import {
	maskDonorEmail,
	maskDonorName,
	maskDonorPhone,
	type DonationRejectReasonCode,
	type PublicDonationDoc,
	type ScanDonationView
} from '$lib/features/donations/server';

/**
 * Project a raw donation doc to the redacted view the scan station needs (no
 * tracking_token_hash, phone_hash, timestamps). Full phone kept for warehouse staff while
 * the goods are still on their way; `_rev` goes out as `rev` and comes back as `expected_rev`
 * (CR-174 FR-25). A RECEIVED donation's contact is masked: its full values leave only through
 * `POST …/contact`, which writes an audit row (CR-214 FR-8b / FR-10a). The scan station turns
 * a received booking away anyway, so nothing there needs the full contact. Shared by the
 * receive route and the close route (CR-206 FR-MP-26) so both answer with the same shape.
 */
export function toScanView(d: PublicDonationDoc): ScanDonationView {
	const masked = d.status === 'received';
	return {
		// CR-174 FR-25 — the counter sends it back so a booking the donor changed while
		// the boxes were being counted is refused instead of received as it was.
		rev: d._rev,
		booking_ref: d.booking_ref,
		shelter_code: d.shelter_code,
		status: d.status,
		donor: masked
			? {
					name: maskDonorName(d.donor?.name),
					phone: d.donor?.phone ? maskDonorPhone(d.donor.phone) : null,
					email: maskDonorEmail(d.donor?.email)
				}
			: {
					name: d.donor?.name ?? '',
					phone: d.donor?.phone ?? null,
					email: d.donor?.email ?? null
				},
		items: (d.items ?? []).map((it) => ({
			item_id: it.item_id,
			free_text: it.free_text,
			qty: it.qty,
			unit: it.unit,
			...(it.note?.trim() ? { note: it.note.trim() } : {}),
			review_status: it.review_status,
			review_reason_code: (it.review_reason_code ?? null) as DonationRejectReasonCode | null,
			review_reason: it.review_reason ?? null,
			// CR-206 FR-MP-19 — which point each line goes to; the screen decides what it may take.
			drop_off_point_id: it.drop_off_point_id ?? null
		})),
		// What each point already recorded (FR-MP-19 "รับแล้วที่ <จุด>"). Ledger and audit ids
		// stay server-side: the screen has no use for them.
		point_receipts: (d.point_receipts ?? []).map((receipt) => ({
			point_id: receipt.point_id,
			line_nos: receipt.line_nos,
			received_at: receipt.received_at,
			received_by: receipt.received_by
		})),
		logistics: d.logistics,
		photos: d.photos ?? []
	};
}
