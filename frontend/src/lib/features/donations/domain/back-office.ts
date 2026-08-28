/**
 * Redacted back-office donation queue row (T-16) — shared between the
 * `GET /api/back-office/donations?status=` list route and the review UI
 * (`PendingReviewBoard`/`PendingReviewDialog`/verifying tab) so both sides
 * agree on shape without the UI reaching into a route module.
 */
export interface PendingDonationRow {
	booking_ref?: string;
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
