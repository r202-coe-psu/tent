import { z } from 'zod';
import { type BaseDoc } from '$lib/db/model';

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
	captchaToken: z
		.string()
		.min(1, 'CAPTCHA token is required')
});

export const isDonationPreDeclaration = (d: unknown): d is DonationPreDeclaration =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation_pre_declaration';
