import { z } from 'zod';
import { qtyStrCoercePositiveSchema } from '$lib/utils/qty';

/**
 * Redacted back-office donation queue row (T-16) — shared between the
 * `GET /api/back-office/donations?status=` list route and the review UI
 * (`PendingReviewBoard`/`PendingReviewDialog`/verifying tab) so both sides
 * agree on shape without the UI reaching into a route module.
 */
export interface PendingDonationRow {
	booking_ref?: string;
	/**
	 * CouchDB doc id. Not decoration: a walk-in has no `booking_ref` (FastAPI mints
	 * those for public bookings only), and every back-office action is addressed by
	 * one handle or the other — see `donationActionRef`.
	 */
	donation_id?: string;
	shelter_code: string;
	status: string;
	donor_name: string;
	donor_phone: string | null;
	donor_email?: string | null;
	item_count: number;
	items: Array<{
		item_id?: string;
		free_text?: string;
		qty: string;
		unit: string;
		category?: string;
		condition?: string;
		note?: string;
	}>;
	declared_at?: string;
	eta?: string;
	slot?: { date: string; from: string; to: string };
	delivery_method?: string;
	vehicle?: string | null;
	pickup_address?: string | null;
	donor_note?: string | null;
	is_unsolicited?: boolean;
}

/**
 * Counter walk-in intake (`POST /api/back-office/donations`).
 *
 * A walk-in is declared and received in the same breath — the donor is standing at
 * the counter — so one payload carries the donor, what was handed over, and where it
 * is being shelved. Lot numbers are NOT accepted: the server mints the per-day
 * sequence (CR-088), exactly as it does for a scanned pre-declaration.
 *
 * `shelter_code` is only honoured for a system admin, who has no shelter of their
 * own; shelter staff always write to their own shelter (scope isolation).
 */
export const walkInIntakeInputSchema = z.object({
	shelter_code: z.string().trim().min(1).optional(),
	donor: z.object({
		name: z.string().trim().min(1, 'ต้องระบุชื่อผู้บริจาค'),
		// Digits only: `donor.phone` feeds `phone_hash`, and a formatted string would
		// hash differently every time the same donor comes back (schema.md §2.3).
		phone: z
			.string()
			.trim()
			.regex(/^[0-9]*$/, 'เบอร์โทรต้องเป็นตัวเลขเท่านั้น')
			.optional(),
		email: z.string().trim().email().optional()
	}),
	items: z
		.array(
			z.object({
				// Walk-in lines always name a catalog item: they become ledger rows
				// immediately, and `stock_ledger.item_id` has to point at a real item.
				item_id: z.string().trim().min(1),
				qty: qtyStrCoercePositiveSchema,
				unit: z.string().trim().min(1),
				lot: z
					.object({
						expiry: z.string().trim().optional(),
						storage_zone: z.string().trim().max(100).optional()
					})
					.optional()
			})
		)
		.min(1, 'ต้องมีรายการสิ่งของอย่างน้อย 1 รายการ'),
	remarks: z.string().trim().optional()
});
export type WalkInIntakeInput = z.infer<typeof walkInIntakeInputSchema>;

/**
 * The handle to address a donation by in `/api/back-office/donations/[query]/…`.
 *
 * Prefers the donor-facing `booking_ref` (what staff read off the ticket) and falls
 * back to the doc id, which every donation has. Callers used to reach for
 * `booking_ref` alone and bail out when it was missing, so a counter-keyed donation
 * could not be approved, rejected, redirected, or received at all.
 */
export function donationActionRef(row: {
	booking_ref?: string;
	donation_id?: string;
}): string | null {
	return row.booking_ref?.trim() || row.donation_id?.trim() || null;
}

/** What to show when a donation has no donor-facing reference of its own. */
export function donationRefLabel(row: { booking_ref?: string }): string {
	return row.booking_ref?.trim() || 'ไม่มีรหัสจอง (คีย์หน้าเคาน์เตอร์)';
}
