import { z } from 'zod';
import { type BaseDoc } from '$lib/db/model';
import type { DonationStatus } from '$lib/features/operations';
import { isRealCalendarDate, SLOT_TIME_PATTERN } from '$lib/features/operations/server';
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
		vehicle_plate?: string; // draft-donation-vehicle-plate — self_dropoff only, donor PII
		slot?: { date: string; from: string; to: string };
		eta?: string;
		courier_tracking_no?: string | null;
		pickup_address?: string;
	};
	booking_ref?: string;
}

/** draft-donation-vehicle-plate — free text, so a donor can type the province in the same field. */
export const VEHICLE_PLATE_MAX = 40;

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
			// Blank after trim = not sent (draft-donation-vehicle-plate FR-1).
			vehicle_plate: z
				.string()
				.trim()
				.max(VEHICLE_PLATE_MAX, 'ทะเบียนรถยาวเกินไป')
				.optional()
				.transform((v) => v || undefined),
			// The donor's window is re-checked against the shelter's published slot by the
			// BFF, but only well-formed input may reach that lookup: `date` and `from` are
			// interpolated into a CouchDB doc id, and `to` is compared against the doc.
			slot: z
				.object({
					date: z
						.string()
						.refine(isRealCalendarDate, 'Slot date must be a real date in YYYY-MM-DD form'),
					from: z.string().regex(SLOT_TIME_PATTERN, 'Slot start must be HH:mm'),
					to: z.string().regex(SLOT_TIME_PATTERN, 'Slot end must be HH:mm')
				})
				.refine((s) => s.to > s.from, {
					message: 'Slot end must be after its start',
					path: ['to']
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
		})
		// draft-donation-vehicle-plate: the shelter's own vehicle collects a pickup, so a plate only fits self_dropoff.
		.refine((l) => !(l.delivery_method !== 'self_dropoff' && l.vehicle_plate), {
			message: 'vehicle_plate is only allowed for self_dropoff',
			path: ['vehicle_plate']
		}),
	captchaToken: z.string().min(1).optional()
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
	// `item_master.category` is a reference to the category doc (`item_category:wash`);
	// legacy `supply_item.category` is the bare code (`hygiene`). Read both.
	const code = category
		?.trim()
		.toLowerCase()
		.replace(/^item_category:/, '');
	switch (code) {
		case 'food':
		case 'water':
		case 'ready_meal':
			return 'food';
		case 'clothing':
		case 'bedding':
			return 'clothing';
		case 'medicine':
		case 'medical':
			return 'medicine';
		case 'hygiene':
		case 'wash':
		case 'equipment':
		case 'kits':
		case 'special_care':
		case 'volunteer_ppe':
		case 'fuel_energy':
			return 'supply';
		case 'other':
			return 'other';
		default:
			return undefined;
	}
}
