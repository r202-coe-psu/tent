import { z } from 'zod';
import { type BaseDoc } from '$lib/db/model';

export interface DonationPreDeclaration extends BaseDoc {
	type: 'donation_pre_declaration';
	tracking_token: string;
	shelter_code: string;
	items_declared: {
		item_name: string;
		qty: number;
		unit: string;
	}[];
	donor_phone_hash: string;
	status: 'declared' | 'received' | 'expired';
}

// schema_v 2 enums (CR-005 §F · schema.md §2.3 logistics, §4.1 supply_item.category)
export const supplyCategoryEnum = z.enum([
	'food',
	'water',
	'medicine',
	'clothing',
	'hygiene',
	'bedding',
	'equipment',
	'other'
]);
export const deliveryMethodEnum = z.enum(['self_dropoff', 'parcel', 'shelter_pickup']);
export const vehicleEnum = z.enum(['motorcycle', 'car', 'pickup', 'truck']);

export const donationPreDeclarationInputSchema = z.object({
	shelter_code: z.string().min(1, 'Please select a shelter.'),
	donor: z.object({
		name: z.string().min(1, 'Name is required'),
		phone: z.string().min(1, 'Phone is required'),
		// schema_v 2 — optional (DN-2)
		line_id: z.string().trim().optional(),
		email: z
			.union([z.string().trim().email('Please enter a valid email'), z.literal('')])
			.optional()
	}),
	items_declared: z
		.array(
			z.object({
				item_id: z.string().optional(),
				item_name: z.string().min(1, 'Please enter an item name'),
				qty: z
					.number()
					.int('Please enter a valid quantity')
					.positive('Please enter a valid quantity'),
				unit: z.string().min(1, 'Please enter a unit'),
				// schema_v 2 — optional
				category: supplyCategoryEnum.optional(),
				condition: z.string().optional(),
				note: z.string().optional()
			})
		)
		.min(1, 'Please add at least one item to the donation'),
	// schema_v 2 logistics (DN-5/DN-6) — `slot` จะเพิ่มเมื่อปลด T-02; ตอนนี้ optional เพื่อ backward-compat
	logistics: z
		.object({
			delivery_method: deliveryMethodEnum.default('self_dropoff'),
			vehicle: vehicleEnum.optional(),
			eta: z.string().optional(),
			courier_tracking_no: z.string().nullable().optional(),
			pickup_address: z.string().optional()
		})
		.optional(),
	captchaToken: z.string().min(1, 'Please verify that you are not a robot.')
});

export type DonationPreDeclarationInput = z.infer<typeof donationPreDeclarationInputSchema>;

export const isDonationPreDeclaration = (d: unknown): d is DonationPreDeclaration =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation_pre_declaration';
