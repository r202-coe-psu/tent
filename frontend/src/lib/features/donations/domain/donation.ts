import { z } from 'zod';
import { type BaseDoc } from '$lib/db/model';


export interface DonationPreDeclaration extends BaseDoc {
    type: 'donation_pre_declaration';
    tracking_token: string;
    shelter_code: string;
    items: {
        item_id: string;
        qty: number;
    }[];
    donor_phone_hash: string;
    status: 'pending' | 'received';
}

export const donationPreDeclarationInputSchema = z.object({
    shelter_code: z.string().min(1, 'Please select a shelter.'),
    items: z.array(
        z.object({
            item_id: z.string().min(1, 'Please select an item'),
            qty: z.number().int('Please enter a valid quantity').positive('Please enter a valid quantity')
        })
    ).min(1, 'Please add at least one item to the donation'),
    phone: z.string().min(1, 'Phone is required'),
})

export const isDonationPreDeclaration = (d: unknown): d is DonationPreDeclaration => !!d && typeof d === 'object' && (d as { type?: unknown }).type === 'donation_pre_declaration';
