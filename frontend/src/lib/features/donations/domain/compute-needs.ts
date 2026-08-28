import type { Donation, DonationCampaign, StockLedger } from '$lib/features/operations';
import { isDonationOutstanding, keyedDonationIds, stockBalance } from '$lib/features/operations';
import { addQty, subQty, qtyGt } from '$lib/utils/qty';

/**
 * Compute remaining needs (remaining = target − donated) and a map of item → campaign.
 *
 * Shared by:
 * - `POST /api/public/v1/donations` (NEED_FULL re-check)
 * - `GET  /api/public/v1/needs`      (needs board aggregation)
 *
 * This avoids three copies of campaign−donated logic drifting apart.
 *
 * @returns `remaining` — Map<item_id, qty_open> summed across campaigns (may be ≤ 0)
 * @returns `itemCampaign` — Map<item_id, campaign_id> (first open campaign that needs the item)
 * @returns `campaignRemaining` — Map<campaign_id, Map<item_id, qty_open>>, the per-campaign
 *   split behind `remaining`. A donation carries exactly one `campaign_id`, so the summed
 *   figure is not by itself bookable — see `pickCampaignForItems`.
 */
export function computeNeeds(
	campaigns: DonationCampaign[],
	donations: Donation[],
	stockLedgers: StockLedger[] = []
): {
	remaining: Map<string, string>;
	itemCampaign: Map<string, string>;
	campaignRemaining: Map<string, Map<string, string>>;
} {
	const remaining = new Map<string, string>();
	const itemCampaign = new Map<string, string>();
	const campaignRemaining = new Map<string, Map<string, string>>();

	// Same terms as the back-office board (deriveNeedAvailability): what the shelter
	// already holds plus what is still owed to it. Deliberately not `calculateReserved` —
	// that one attributes a donation with no campaign_id to every campaign and guesses an
	// item_id from free text, both of which this side dropped on purpose.
	const onHand = stockBalance(stockLedgers);
	const keyed = keyedDonationIds(stockLedgers);

	for (const campaign of campaigns) {
		const covered = new Map(onHand);
		for (const don of donations) {
			if (don.campaign_id !== campaign._id) continue;
			// Terminal without goods ever landing here — `redirected`/`rejected` joined
			// the enum with CR-052 and release their share just like expiry does.
			if (!isDonationOutstanding(don.status) && don.status !== 'received') continue;
			// Received *and* already booked into the ledger: the goods are on the shelf,
			// counted in onHand. Counting them again here closes the need at half.
			if (don.status === 'received' && keyed.has(don._id)) continue;
			for (const it of don.items ?? []) {
				if (!it.item_id) continue;
				covered.set(it.item_id, addQty(covered.get(it.item_id) ?? '0', it.qty));
			}
		}
		for (const need of campaign.needs) {
			// A need staff closed by hand takes no more (T-22 manual force cut-off,
			// CR-052). It still contributes a zero rather than being skipped: callers
			// treat a missing key as "not tracked" and let the booking through, so
			// dropping it here would reopen exactly what the close was meant to stop.
			const rem =
				need.status === 'closed' ? '0' : subQty(need.qty_target, covered.get(need.item_id) ?? '0');
			remaining.set(need.item_id, addQty(remaining.get(need.item_id) ?? '0', rem));
			const perItem = campaignRemaining.get(campaign._id) ?? new Map<string, string>();
			perItem.set(need.item_id, rem);
			campaignRemaining.set(campaign._id, perItem);
			// Bind the item to a campaign still accepting it, so a closed need in one
			// campaign cannot capture a donation another campaign can actually take.
			if (need.status !== 'closed' && !itemCampaign.has(need.item_id)) {
				itemCampaign.set(need.item_id, campaign._id);
			}
		}
	}
	return { remaining, itemCampaign, campaignRemaining };
}

/** What a donation asks for, as far as campaign selection is concerned. */
export type RequestedItem = { item_id?: string | null; qty: string | number };

export type CampaignPick = { ok: true; campaignId: string | null } | { ok: false; itemId: string };

/**
 * Choose the campaign that can actually take this donation.
 *
 * A donation carries exactly one `campaign_id`, but `computeNeeds().remaining` sums an
 * item across every open campaign asking for it. Binding to the first campaign that
 * merely *mentions* the item — the old behaviour — meant a donor could be shown 590 kg
 * of headroom, request 200, and be refused because the campaign they were bound to had
 * only 90 left while another campaign sat on 500 nobody could reach.
 *
 * So pick a campaign whose own remaining covers **every** quota-tracked item in the
 * request. Campaign order decides ties, which keeps the choice deterministic and keeps
 * older campaigns filling first.
 *
 * Returns `campaignId: null` when nothing in the request is quota-tracked (free-text
 * only, or items no open campaign asks for) — those bypass the counter as they always
 * have. Returns `ok: false` with the offending item when no single campaign can serve
 * the request; the summed figure was never bookable in one booking.
 */
export function pickCampaignForItems(
	campaignRemaining: Map<string, Map<string, string>>,
	items: RequestedItem[]
): CampaignPick {
	const perCampaign = [...campaignRemaining.entries()];
	const fits = (perItem: Map<string, string>, item: RequestedItem) =>
		!qtyGt(item.qty, perItem.get(item.item_id as string) ?? '0');

	const tracked = items.filter(
		(item) =>
			!!item.item_id && perCampaign.some(([, perItem]) => perItem.has(item.item_id as string))
	);
	if (tracked.length === 0) return { ok: true, campaignId: null };

	for (const [campaignId, perItem] of perCampaign) {
		if (tracked.every((item) => fits(perItem, item))) return { ok: true, campaignId };
	}

	// Name the item no campaign can serve on its own; if each is individually servable
	// but no campaign covers the whole request, the first tracked item stands for it.
	const offender =
		tracked.find((item) => !perCampaign.some(([, perItem]) => fits(perItem, item))) ?? tracked[0];
	return { ok: false, itemId: offender.item_id as string };
}
