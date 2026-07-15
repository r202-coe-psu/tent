import { z } from 'zod';
import type { Donation, Donor } from '$lib/features/operations';
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

/** Back-office scan station — receive-donation mutation body (status locked to `received`). */
export const receiveDonationInputSchema = z.object({
	status: z.literal('received'),
	items: z
		.array(
			z.object({
				item_id: z.string().optional(),
				free_text: z.string().optional(),
				qty: qtyStrCoercePositiveSchema,
				unit: z.string().min(1)
			})
		)
		.optional()
});

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
