import { z } from 'zod';
import type { Donation, DonationStatus, Donor } from '$lib/features/operations';
import { qtyStrCoercePositiveSchema } from '$lib/utils/qty';

export interface PublicDonor extends Donor {
	line_id?: string;
	email?: string;
}

export interface PublicDonationDoc extends Omit<Donation, 'donor'> {
	donor: PublicDonor;
	booking_ref?: string;
	logistics?: {
		delivery_method: 'self_dropoff' | 'parcel' | 'shelter_pickup';
		vehicle?: 'motorcycle' | 'car' | 'pickup' | 'truck';
		slot?: { date: string; from: string; to: string };
		eta?: string;
		courier_tracking_no?: string | null;
		pickup_address?: string;
	};
	received_summary?: {
		total_items: number;
		received_at: string;
		remarks?: string;
	};
	items_declared?: Array<{
		item_id?: string;
		free_text?: string;
		category?: string;
		qty: string;
		unit: string;
		condition?: string;
		note?: string;
	}>;
	/**
	 * Append-only log of donor edits to `items` (schema.md §2.3, CR-080). Snapshots of
	 * the whole basket before and after, not diffs — staff reading the booking before
	 * accepting goods need to see what it used to be without reassembling it.
	 */
	revisions?: DonationRevision[];
}

export interface DonationRevision {
	at: string;
	by: 'donor' | 'staff';
	items_before: Array<{ item_id?: string; free_text?: string; qty: string; unit: string }>;
	items_after: Array<{ item_id?: string; free_text?: string; qty: string; unit: string }>;
}

/**
 * Redacted projection of a donation for the authorized back-office scan station.
 * Only the fields the scan UI needs — never the raw CouchDB doc (`_rev`,
 * `tracking_token_hash`, `phone_hash`, timestamps, …). Full donor `phone` is
 * intentionally included (authorized warehouse staff need it to contact donors).
 */
export interface ScanDonationView {
	booking_ref?: string;
	shelter_code: string;
	status: string;
	donor: { name: string; phone: string | null };
	items: Array<{ item_id?: string; free_text?: string; qty: string; unit: string }>;
	logistics?: PublicDonationDoc['logistics'];
}

/**
 * Back-office scan station — receive-donation mutation body (status locked to `received`).
 *
 * `items` here are what staff physically COUNTED, which may differ from what the
 * donor declared. Lines carrying an `item_id` mint a `stock_ledger` entry; free-text
 * lines stay on the donation only (they are not in the catalog, so they cannot be
 * counted as stock — schema.md §2.1 requires a real `item_id` + matching `unit`).
 */
export const receiveDonationInputSchema = z.object({
	status: z.literal('received'),
	/** Optional note from the receiving staff — lands on `received_summary.remarks`. */
	remarks: z.string().trim().max(500).optional(),
	items: z
		.array(
			z.object({
				item_id: z.string().optional(),
				free_text: z.string().optional(),
				qty: qtyStrCoercePositiveSchema,
				unit: z.string().min(1),
				/**
				 * `lot_no` is NOT accepted from the client — the server mints it at
				 * receive time so the per-day sequence stays under one authority
				 * (CR-088). Zod strips it if a caller sends one anyway.
				 */
				lot: z
					.object({
						expiry: z.string().optional(),
						note: z.string().trim().optional(),
						storage_zone: z.string().trim().max(100).optional()
					})
					.optional()
			})
		)
		.optional()
});
export type ReceiveDonationInput = z.infer<typeof receiveDonationInputSchema>;

/**
 * Statuses in which a donor may still change their own booking through the public
 * token routes (T-21 DoD — "Donor แก้/ยกเลิกการจองของตนผ่าน token ได้").
 *
 * Only a reservation still awaiting drop-off qualifies. Once goods arrive the count
 * belongs to staff and the stock ledger, and `cancelled`/`expired` have already
 * released their quota — reopening either would desync the counter.
 *
 * CR-052 adds `pending_review`/`verifying`, which also await drop-off; add them here
 * when those statuses land so both routes pick the change up at once.
 */
const DONOR_EDITABLE_STATUSES = new Set<DonationStatus>(['declared']);

export function isDonorEditable(status: DonationStatus): boolean {
	return DONOR_EDITABLE_STATUSES.has(status);
}

const PUBLIC_DONATION_ERROR_MESSAGES: Record<string, string> = {
	NEED_FULL: 'รายการนี้รับบริจาคครบแล้ว กรุณาเลือกรายการอื่น',
	SLOT_FULL: 'คิวจัดส่งเต็มแล้ว กรุณาเลือกช่วงเวลาอื่น',
	SHELTER_NOT_FOUND: 'ไม่พบศูนย์พักพิงที่เลือก',
	SHELTER_CLOSED: 'ศูนย์พักพิงนี้ปิดรับบริจาคชั่วคราว',
	RATE_LIMITED: 'คุณส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
};

/** Map public donation API error codes to donor-facing Thai copy. */
export function publicDonationErrorMessage(code: string): string {
	return PUBLIC_DONATION_ERROR_MESSAGES[code] ?? 'ไม่สามารถจองคิวบริจาคได้ กรุณาลองใหม่อีกครั้ง';
}
