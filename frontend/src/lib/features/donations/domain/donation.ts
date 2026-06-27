import { z } from 'zod';
import { type BaseDoc, touch } from '$lib/db/model';
import { createAuditEntry, type AuditEntry, type AuditAction } from '$lib/features/shared';

// ---------------------------------------------------------------------------
// Document type
// ---------------------------------------------------------------------------

export interface DonationPreDeclaration extends BaseDoc {
	type: 'donation_pre_declaration';
	tracking_token: string;
	shelter_code: string;
	items: {
		free_text: string;
		category?: string;
		qty: number;
		unit: string;
		condition?: string;
		note?: string;
	}[];
	donor_phone_hash: string;
	status: 'declared' | 'received' | 'expired';
	logistics?: {
		delivery_method: 'self_dropoff' | 'parcel' | 'shelter_pickup';
		vehicle?: 'motorcycle' | 'car' | 'pickup' | 'truck';
		slot?: { date: string; from: string; to: string };
		eta?: string;
		courier_tracking_no?: string | null;
		pickup_address?: string;
	};
	booking_ref?: string;
}

// ---------------------------------------------------------------------------
// Input schema (Zod) — for form validation / API ingress
// ---------------------------------------------------------------------------

export const donationPreDeclarationInputSchema = z.object({
	shelter_code: z.string().min(1, 'Please select a shelter.'),
	donor: z.object({
		name: z.string().min(1, 'Name is required'),
		phone: z.string().min(1, 'Phone is required'),
		line_id: z.string().optional(),
		email: z.string().email().optional().or(z.literal(''))
	}),
	items: z
		.array(
			z.object({
				free_text: z.string().min(1, 'Please enter an item name'),
				category: z.string().optional(),
				qty: z
					.number()
					.int('Please enter a valid quantity')
					.positive('Please enter a valid quantity'),
				unit: z.string().min(1, 'Please enter a unit'),
				condition: z.string().optional(),
				note: z.string().optional()
			})
		)
		.min(1, 'Please add at least one item to the donation'),
	logistics: z
		.object({
			delivery_method: z.enum(['self_dropoff', 'parcel', 'shelter_pickup']),
			vehicle: z.enum(['motorcycle', 'car', 'pickup', 'truck']).optional(),
			slot: z
				.object({
					date: z.string(),
					from: z.string(),
					to: z.string()
				})
				.optional(),
			eta: z.string().optional(),
			courier_tracking_no: z.string().nullable().optional(),
			pickup_address: z.string().optional()
		})
		.optional(),
	captchaToken: z.string().optional()
});

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export const isDonationPreDeclaration = (d: unknown): d is DonationPreDeclaration =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation_pre_declaration';

// ---------------------------------------------------------------------------
// Donation Intake — T-16-3.2
// ---------------------------------------------------------------------------

/** Input required for a staff member to record receiving a donation. */
export interface DonationIntakeInput {
	/** เหตุผลการรับของ — บังคับระบุ */
	reason: string;
	/** ชื่อเจ้าหน้าที่ที่ลงชื่อทำรายการ */
	staff_name: string;
	/**
	 * action ของ audit:
	 * - `manual_adjust` — รับของปกติ (walk-in / ตาม pre-declare) [default]
	 * - `retro_edit`    — บันทึกย้อนหลังหลังรับไปแล้ว
	 */
	action?: Extract<AuditAction, 'manual_adjust' | 'retro_edit'>;
}

/**
 * Transition a donation from `declared` → `received` and produce an audit trail.
 *
 * Returns:
 * - `donation` — updated doc with `status: 'received'` (caller writes to PouchDB)
 * - `audit`    — immutable `type: "audit"` doc (caller writes to PouchDB in the same batch)
 *
 * Throws if the donation is not in `declared` status (state-machine guard).
 */
export function receiveDonation(
	donation: DonationPreDeclaration,
	input: DonationIntakeInput
): { donation: DonationPreDeclaration; audit: AuditEntry } {
	if (donation.status !== 'declared') {
		throw new Error(
			`Cannot receive donation with status "${donation.status}". Only "declared" donations can be received.`
		);
	}

	const action = input.action ?? 'manual_adjust';

	// Transition the donation doc to 'received' (touch bumps updated_at)
	const updatedDonation: DonationPreDeclaration = touch({
		...donation,
		status: 'received'
	});

	// Build the append-only audit entry — ห้ามแก้หลังสร้าง (schema.md §2.12)
	const audit = createAuditEntry(
		{
			action,
			target_type: 'donation',
			target_id: donation._id,
			reason: input.reason,
			context: {
				staff_name: input.staff_name,
				booking_ref: donation.booking_ref ?? null,
				item_count: donation.items.length
			}
		},
		{
			shelterCode: donation.shelter_code,
			createdBy: input.staff_name
		}
	);

	return { donation: updatedDonation, audit };
}
