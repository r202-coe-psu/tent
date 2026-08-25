/**
 * The T-22 remaining-need rule, checked across the copies that implement it.
 *
 * `remaining = target − (on_hand + reserved)` lives in three places (see
 * `packages/needs-fixtures/README.md`). Each already has unit tests, and all of them
 * passed while two of the three were quietly using an older formula without the
 * warehouse term — because no test looked at more than one copy at a time.
 *
 * These do. The shared cases are read from `packages/needs-fixtures/cases.json`; the
 * Python side asserts the same numbers in `worker/tests/test_needs_parity.py`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeNeeds, pickCampaignForItems } from './compute-needs';
import { deriveNeedAvailability } from '$lib/features/operations';
import type {
	Donation,
	DonationCampaign,
	StockLedger,
	CampaignNeed
} from '$lib/features/operations';

type Case = {
	name: string;
	why: string;
	campaigns: { _id: string; needs: CampaignNeed[] }[];
	donations: { _id: string; campaign_id: string; status: string; items: unknown[] }[];
	stock_ledgers: { item_id: string; qty: string; reason: string; ref_id: string | null }[];
	expected_remaining: Record<string, number>;
	expected_per_campaign: Record<string, Record<string, number>>;
};

const FIXTURES = fileURLToPath(
	new URL('../../../../../../packages/needs-fixtures/cases.json', import.meta.url)
);
const cases: Case[] = JSON.parse(readFileSync(FIXTURES, 'utf8')).cases;

const BASE = {
	schema_v: 1,
	created_at: '2026-08-01T00:00:00Z',
	updated_at: '2026-08-01T00:00:00Z',
	created_by: 'test'
};

const asCampaigns = (c: Case): DonationCampaign[] =>
	c.campaigns.map(
		(raw) =>
			({
				...BASE,
				_id: raw._id,
				type: 'donation_campaign',
				status: 'open',
				title: raw._id,
				shelter_code: 'SH001',
				needs: raw.needs.map((n) => ({ ...n, unit: n.unit ?? 'kg' }))
			}) as unknown as DonationCampaign
	);

const asDonations = (c: Case): Donation[] =>
	c.donations.map((raw) => ({ ...BASE, ...raw, type: 'donation' }) as unknown as Donation);

const asLedgers = (c: Case): StockLedger[] =>
	c.stock_ledgers.map(
		(raw, i) => ({ ...BASE, _id: `stock_ledger:${i}`, type: 'stock_ledger', ...raw }) as StockLedger
	);

describe('T-22 remaining-need parity', () => {
	describe.each(cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
		it(testCase.why, () => {
			const { remaining } = computeNeeds(
				asCampaigns(testCase),
				asDonations(testCase),
				asLedgers(testCase)
			);
			for (const [itemId, expected] of Object.entries(testCase.expected_remaining)) {
				expect(Number(remaining.get(itemId))).toBe(expected);
			}
		});

		it('splits the same way per campaign', () => {
			const { campaignRemaining } = computeNeeds(
				asCampaigns(testCase),
				asDonations(testCase),
				asLedgers(testCase)
			);
			for (const [campaignId, perItem] of Object.entries(testCase.expected_per_campaign)) {
				for (const [itemId, expected] of Object.entries(perItem)) {
					expect(Number(campaignRemaining.get(campaignId)?.get(itemId))).toBe(expected);
				}
			}
		});

		it('matches the back-office board, which is the reference for this rule', () => {
			// deriveNeedAvailability got the warehouse term first (CR-034); the donation
			// side is the copy that fell behind. Compare what each side would actually
			// offer a donor, not the raw fields: the back-office keeps qty_remaining at
			// face value and carries a separate is_cut_off flag (openNeeds drops those
			// rows), while this side folds the cut-off into a zero. Same answer, different
			// shape. Ours clamps for the comparison since negatives never reach a donor.
			// Cases stay in the common domain — see the fixtures README.
			const campaigns = asCampaigns(testCase);
			const donations = asDonations(testCase);
			const ledgers = asLedgers(testCase);
			const { campaignRemaining } = computeNeeds(campaigns, donations, ledgers);

			for (const campaign of campaigns) {
				for (const availability of deriveNeedAvailability(campaign, donations, ledgers)) {
					const ours = Number(campaignRemaining.get(campaign._id)?.get(availability.item_id));
					const theirs = availability.is_cut_off ? 0 : Number(availability.qty_remaining);
					expect(Math.max(0, ours)).toBe(theirs);
				}
			}
		});
	});
});

describe('T-22 invariant — what is advertised has to be bookable', () => {
	/**
	 * The other failure mode. `remaining` sums an item across campaigns, but a donation
	 * carries one `campaign_id`, so the headline figure is not by itself bookable. Before
	 * `pickCampaignForItems`, a donor shown 590 kg who asked for 200 was refused because
	 * the binding landed on a campaign holding 40 while another sat on 500.
	 *
	 * The property that must hold: whatever the largest single campaign can take, the
	 * booking path accepts. Anything less and quota exists that no donor can reach.
	 */
	function maxSingleCampaign(perCampaign: Map<string, Map<string, string>>, itemId: string) {
		return Math.max(0, ...[...perCampaign.values()].map((p) => Number(p.get(itemId) ?? '0')));
	}

	it.each(cases.map((c) => [c.name, c] as const))(
		'%s — the largest campaign-sized booking is accepted',
		(_name, testCase) => {
			const { campaignRemaining } = computeNeeds(
				asCampaigns(testCase),
				asDonations(testCase),
				asLedgers(testCase)
			);

			for (const itemId of Object.keys(testCase.expected_remaining)) {
				const bookable = maxSingleCampaign(campaignRemaining, itemId);
				if (bookable <= 0) continue;
				expect(
					pickCampaignForItems(campaignRemaining, [{ item_id: itemId, qty: String(bookable) }])
				).toEqual({ ok: true, campaignId: expect.any(String) });
			}
		}
	);

	it.each(cases.map((c) => [c.name, c] as const))(
		'%s — nothing is bookable once every campaign is full',
		(_name, testCase) => {
			const { campaignRemaining } = computeNeeds(
				asCampaigns(testCase),
				asDonations(testCase),
				asLedgers(testCase)
			);

			for (const itemId of Object.keys(testCase.expected_remaining)) {
				if (maxSingleCampaign(campaignRemaining, itemId) > 0) continue;
				expect(pickCampaignForItems(campaignRemaining, [{ item_id: itemId, qty: '1' }]).ok).toBe(
					false
				);
			}
		}
	);

	it('records the gap the sum still leaves open', () => {
		// Two campaigns, 40 + 500. The board advertises 540; the most one booking can take
		// is 500. Asserting it here rather than leaving it implied: closing it means either
		// splitting a donation across campaigns or changing what the board displays, and
		// both change behaviour T-60 specifies — an owner decision, not a code cleanup.
		const twoCampaigns = cases.find((c) => c.name === 'two campaigns want the same item')!;
		const { remaining, campaignRemaining } = computeNeeds(
			asCampaigns(twoCampaigns),
			asDonations(twoCampaigns),
			asLedgers(twoCampaigns)
		);

		expect(Number(remaining.get('item:rice'))).toBe(540);
		expect(maxSingleCampaign(campaignRemaining, 'item:rice')).toBe(500);
		expect(pickCampaignForItems(campaignRemaining, [{ item_id: 'item:rice', qty: '540' }])).toEqual(
			{ ok: false, itemId: 'item:rice' }
		);
	});
});
