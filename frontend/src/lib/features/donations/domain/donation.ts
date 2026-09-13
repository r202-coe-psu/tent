import { z } from 'zod';
import { type BaseDoc } from '$lib/db/model';
import type { DonationStatus } from '$lib/features/operations';
import { qtyStrCoercePositiveSchema } from '$lib/utils/qty';

export const PUBLIC_DONATION_CATEGORIES = [
	{ value: 'food', label: 'อาหาร/เครื่องดื่ม' },
	{ value: 'clothing', label: 'เสื้อผ้า/เครื่องนุ่งห่ม' },
	{ value: 'medicine', label: 'ยารักษาโรค/เวชภัณฑ์' },
	{ value: 'supply', label: 'ของใช้ทั่วไป' },
	{ value: 'other', label: 'อื่นๆ' }
] as const;

export interface DonationPreDeclaration extends BaseDoc {
	type: 'donation_pre_declaration';
	tracking_token: string;
	shelter_code: string;
	items: {
		item_id?: string;
		free_text: string;
		category?: string;
		qty: string; // qty_str
		unit: string;
		condition?: string;
		note?: string;
	}[];
	donor_phone_hash: string;
	/**
	 * Same lifecycle as `donation.status` (schema.md §2.3) — CR-052 added the review
	 * chain, so this union is the shared `DonationStatus` rather than its own list; two
	 * copies is how one of them silently stops accepting `pending_review`.
	 */
	status: DonationStatus;
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

export const donationPreDeclarationInputSchema = z.object({
	shelter_code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/, 'Invalid shelter code.'),
	donor: z.object({
		name: z.string().min(1, 'Name is required'),
		phone: z.string().min(1, 'Phone is required'),
		line_id: z.string().optional(),
		email: z.string().email().optional().or(z.literal(''))
	}),
	items: z
		.array(
			z.object({
				// item_id links the donation to a catalog item so needs_open can be reduced
				// (schema.md §2.3 — item_id OR free_text). The board pre-fills item_id from a need card.
				item_id: z.string().optional(),
				free_text: z.string().min(1, 'Please enter an item name'),
				category: z.string().optional(),
				qty: qtyStrCoercePositiveSchema,
				unit: z.string().min(1, 'Please enter a unit'),
				condition: z.string().optional(),
				note: z.string().optional()
			})
		)
		.min(1, 'Please add at least one item to the donation'),
	// logistics เป็น req เมื่อ channel=public (schema.md §2.3) — public POST ทุกใบต้องมี
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
		// vehicle เฉพาะ self_dropoff/shelter_pickup — ห้ามมากับ parcel (schema.md §2.3)
		.refine((l) => !(l.delivery_method === 'parcel' && l.vehicle), {
			message: 'vehicle is only allowed for self_dropoff or shelter_pickup',
			path: ['vehicle']
		}),
	captchaToken: z.string().min(1, 'CAPTCHA token is required')
});

export const isDonationPreDeclaration = (d: unknown): d is DonationPreDeclaration =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation_pre_declaration';

/**
 * Catalog category (`supply_item.category` / `item_master.category`) → the vocabulary
 * the donor form offers (`PUBLIC_DONATION_CATEGORIES`).
 *
 * The two lists are not the same and never were: the catalog splits `water` from
 * `food` and carries `hygiene` / `bedding` / `equipment`, while the donor sees five
 * coarse buckets. The needs card therefore cannot copy the catalog value straight
 * into `items[].category` — and until this existed it fell back to `'food'` for
 * everything, so a blanket booked from the needs board was filed as food (schema.md
 * §2.3 `items[].category` is the label staff sort by at intake).
 *
 * Returns `undefined` for an unknown or missing category so the caller can leave the
 * field empty rather than guess — an empty category is honest, a wrong one is not.
 */
export function donorCategoryFromCatalog(category?: string | null): string | undefined {
	switch (category?.trim().toLowerCase()) {
		case 'food':
		case 'water':
			return 'food';
		case 'clothing':
		case 'bedding':
			return 'clothing';
		case 'medicine':
			return 'medicine';
		case 'hygiene':
		case 'equipment':
			return 'supply';
		case 'other':
			return 'other';
		default:
			return undefined;
	}
}
