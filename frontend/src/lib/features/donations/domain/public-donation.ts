import type { Donation, Donor } from '$lib/features/operations/domain/operations';

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
		qty: number;
		unit: string;
		condition?: string;
		note?: string;
	}>;
}
