import { donationPayloadUnit } from '$lib/features/donations';
import type { DonationItem } from './donation.svelte';

/**
 * Maps the donor's lines onto the BFF `items[]`. `qty` is sent exactly as typed — a 0 is
 * NOT coerced to 1 (#822) and an empty list is NOT replaced by a fake item; the BFF
 * rejects both with 422.
 */
export function buildDonationItemsPayload(
	items: DonationItem[],
	t: { unspecified: string; defaultItemUnit: string }
) {
	return items.map((it) => ({
		item_id: it.item_id || undefined,
		free_text: it.name || t.unspecified,
		category: it.category || undefined,
		qty: it.amount,
		unit: donationPayloadUnit(it, t.defaultItemUnit),
		condition: it.condition || undefined,
		note: it.remark || undefined
	}));
}
