import type { Donation, DonationCampaign } from '$lib/features/operations';
import { addQty, subQty } from '$lib/utils/qty';

/**
 * Compute remaining needs (remaining = target − donated) and a map of item → campaign.
 *
 * Shared by:
 * - `POST /api/public/v1/donations` (NEED_FULL re-check)
 * - `GET  /api/public/v1/needs`      (needs board aggregation)
 *
 * This avoids three copies of campaign−donated logic drifting apart.
 *
 * @returns `remaining` — Map<item_id, qty_open> (may be ≤ 0 for NEED_FULL / "งดรับ")
 * @returns `itemCampaign` — Map<item_id, campaign_id> (first open campaign that needs the item)
 */
export function computeNeeds(
	campaigns: DonationCampaign[],
	donations: Donation[]
): { remaining: Map<string, string>; itemCampaign: Map<string, string> } {
	const remaining = new Map<string, string>();
	const itemCampaign = new Map<string, string>();

	for (const campaign of campaigns) {
		const covered = new Map<string, string>();
		for (const don of donations) {
			if (don.campaign_id !== campaign._id) continue;
			if (don.status === 'expired' || don.status === 'cancelled') continue;
			for (const it of don.items ?? []) {
				if (!it.item_id) continue;
				covered.set(it.item_id, addQty(covered.get(it.item_id) ?? '0', it.qty));
			}
		}
		for (const need of campaign.needs) {
			const rem = subQty(need.qty_target, covered.get(need.item_id) ?? '0');
			remaining.set(need.item_id, addQty(remaining.get(need.item_id) ?? '0', rem));
			if (!itemCampaign.has(need.item_id)) itemCampaign.set(need.item_id, campaign._id);
		}
	}
	return { remaining, itemCampaign };
}
