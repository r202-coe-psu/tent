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

export const donationPreDeclarationInputSchema = z.object({
	shelter_code: z.string().min(1, 'Please select a shelter.'),
	donor: z.object({
		name: z.string().min(1, 'Name is required'),
		phone: z.string().min(1, 'Phone is required')
	}),
	items_declared: z
		.array(
			z.object({
				item_name: z.string().min(1, 'Please enter an item name'),
				qty: z
					.number()
					.int('Please enter a valid quantity')
					.positive('Please enter a valid quantity'),
				unit: z.string().min(1, 'Please enter a unit')
			})
		)
		.min(1, 'Please add at least one item to the donation'),
	captchaToken: z.string().min(1, 'Please verify that you are not a robot.')
});

export const isDonationPreDeclaration = (d: unknown): d is DonationPreDeclaration =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation_pre_declaration';
