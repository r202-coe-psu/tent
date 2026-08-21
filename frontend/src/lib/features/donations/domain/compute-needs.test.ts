import { describe, it, expect } from 'vitest';
import { computeNeeds, pickCampaignForItems } from './compute-needs';
import type {
	StockLedger,
	CampaignNeed,
	Donation,
	DonationCampaign,
	DonationStatus
} from '$lib/features/operations';

const BASE = {
	schema_v: 2,
	shelter_code: 'SH001',
	created_at: '2026-07-01T00:00:00.000Z',
	updated_at: '2026-07-01T00:00:00.000Z',
	created_by: 'tester'
};

function campaign(id: string, needs: CampaignNeed[]): DonationCampaign {
	return {
		...BASE,
		_id: id,
		type: 'donation_campaign',
		title: `campaign ${id}`,
		needs,
		status: 'open'
	};
}

function need(item_id: string, qty_target: string, status?: 'open' | 'closed'): CampaignNeed {
	return { item_id, qty_target, unit: 'kg', ...(status ? { status } : {}) };
}

function donation(
	id: string,
	campaign_id: string | null,
	status: DonationStatus,
	items: { item_id?: string; free_text?: string; qty: string }[]
): Donation {
	return {
		...BASE,
		_id: id,
		type: 'donation',
		channel: 'public',
		donor: { name: 'Donor', phone: null, phone_hash: 'hash' },
		kind: 'items',
		items: items.map((it) => ({ ...it, unit: 'kg' })),
		campaign_id,
		status,
		tracking_token_hash: `hash-${id}`,
		declared_at: '2026-07-01T00:00:00.000Z',
		received_at: null,
		expires_at: '2026-07-04T00:00:00.000Z'
	};
}

describe('computeNeeds', () => {
	it('returns the full target when nothing has been donated', () => {
		const { remaining } = computeNeeds([campaign('c1', [need('item:rice', '100')])], []);
		expect(remaining.get('item:rice')).toBe('100');
	});

	it('subtracts what has already been declared or received', () => {
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '100')])],
			[
				donation('donation:1', 'c1', 'declared', [{ item_id: 'item:rice', qty: '30' }]),
				donation('donation:2', 'c1', 'received', [{ item_id: 'item:rice', qty: '20' }])
			]
		);
		expect(remaining.get('item:rice')).toBe('50');
	});

	it('ignores expired and cancelled donations', () => {
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '100')])],
			[
				donation('donation:1', 'c1', 'expired', [{ item_id: 'item:rice', qty: '40' }]),
				donation('donation:2', 'c1', 'cancelled', [{ item_id: 'item:rice', qty: '40' }])
			]
		);
		expect(remaining.get('item:rice')).toBe('100');
	});

	it('ignores donations belonging to another campaign', () => {
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '100')])],
			[donation('donation:1', 'c2', 'declared', [{ item_id: 'item:rice', qty: '40' }])]
		);
		expect(remaining.get('item:rice')).toBe('100');
	});

	it('ignores donations with no campaign at all', () => {
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '100')])],
			[donation('donation:1', null, 'declared', [{ item_id: 'item:rice', qty: '40' }])]
		);
		expect(remaining.get('item:rice')).toBe('100');
	});

	it('goes to zero and below once the target is met or overshot', () => {
		// The needs board reads ≤ 0 as "งดรับ" and the POST re-check as NEED_FULL, so the
		// sign has to survive rather than being clamped.
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '100')])],
			[donation('donation:1', 'c1', 'declared', [{ item_id: 'item:rice', qty: '120' }])]
		);
		expect(remaining.get('item:rice')).toBe('-20');
	});

	it('accumulates the same item across campaigns instead of overwriting it', () => {
		// Two shelters' worth of campaigns can each want rice; the board shows one number
		// per item, so the shortfalls add up. Overwriting here would silently hide a need.
		const { remaining } = computeNeeds(
			[
				campaign('c1', [need('item:rice', '100')]),
				campaign('c2', [need('item:rice', '50')]),
				campaign('c3', [need('item:rice', '25')])
			],
			[donation('donation:1', 'c1', 'declared', [{ item_id: 'item:rice', qty: '10' }])]
		);
		expect(remaining.get('item:rice')).toBe('165');
	});

	it('drops donated items that the bound campaign does not ask for', () => {
		// Locks in current behaviour: the outer loop walks campaign.needs, so a donation
		// booked against a campaign that never listed the item is discarded silently.
		// This is how 20 blankets bound to a rice+water campaign went uncounted in dev.
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '100')])],
			[
				donation('donation:1', 'c1', 'declared', [
					{ item_id: 'item:rice', qty: '10' },
					{ item_id: 'item:blanket', qty: '20' }
				])
			]
		);
		expect(remaining.get('item:rice')).toBe('90');
		expect(remaining.has('item:blanket')).toBe(false);
	});

	it('skips free-text items with no item_id', () => {
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '100')])],
			[
				donation('donation:1', 'c1', 'declared', [
					{ free_text: 'ข้าวสาร', qty: '40' },
					{ item_id: 'item:rice', qty: '10' }
				])
			]
		);
		expect(remaining.get('item:rice')).toBe('90');
	});

	it('keeps decimal quantities exact', () => {
		// Decimal helpers, not JS floats: 0.1 + 0.2 must not drift to 0.30000000000000004.
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:oil', '1')])],
			[
				donation('donation:1', 'c1', 'declared', [{ item_id: 'item:oil', qty: '0.1' }]),
				donation('donation:2', 'c1', 'declared', [{ item_id: 'item:oil', qty: '0.2' }])
			]
		);
		expect(remaining.get('item:oil')).toBe('0.7');
	});

	it('handles a donation document with no items array', () => {
		const bare = donation('donation:1', 'c1', 'declared', []);
		delete bare.items;
		const { remaining } = computeNeeds([campaign('c1', [need('item:rice', '100')])], [bare]);
		expect(remaining.get('item:rice')).toBe('100');
	});

	it('reports a manually closed need as taking nothing more', () => {
		// Staff force cut-off of a single item (T-22 §1.6, CR-052 needs[].status).
		const { remaining } = computeNeeds([campaign('c1', [need('item:rice', '100', 'closed')])], []);
		expect(remaining.get('item:rice')).toBe('0');
	});

	it('keeps a closed need in the map instead of dropping it', () => {
		// Callers read a missing key as "not tracked" and let the booking through, so
		// omitting a closed item would reopen exactly what the close was meant to stop.
		const { remaining } = computeNeeds([campaign('c1', [need('item:rice', '100', 'closed')])], []);
		expect(remaining.has('item:rice')).toBe(true);
	});

	it('ignores donations already counted against a closed need', () => {
		// The target is off the table entirely — not "target minus what arrived".
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '100', 'closed')])],
			[donation('donation:1', 'c1', 'declared', [{ item_id: 'item:rice', qty: '30' }])]
		);
		expect(remaining.get('item:rice')).toBe('0');
	});

	it('still offers an item another campaign has open', () => {
		// Closing rice in one campaign must not close it network-wide.
		const { remaining } = computeNeeds(
			[
				campaign('c1', [need('item:rice', '100', 'closed')]),
				campaign('c2', [need('item:rice', '40')])
			],
			[]
		);
		expect(remaining.get('item:rice')).toBe('40');
	});

	describe('itemCampaign', () => {
		it('binds each item to the first campaign that asks for it', () => {
			const { itemCampaign } = computeNeeds(
				[
					campaign('c1', [need('item:rice', '100')]),
					campaign('c2', [need('item:rice', '50'), need('item:water', '10')])
				],
				[]
			);
			expect(itemCampaign.get('item:rice')).toBe('c1');
			expect(itemCampaign.get('item:water')).toBe('c2');
		});

		it('skips a campaign whose need for the item is closed', () => {
			// Binding to the closed campaign would hand the donation to a counter that
			// still has room, while the campaign that can actually take it goes unused.
			const { itemCampaign } = computeNeeds(
				[
					campaign('c1', [need('item:rice', '100', 'closed')]),
					campaign('c2', [need('item:rice', '40')])
				],
				[]
			);
			expect(itemCampaign.get('item:rice')).toBe('c2');
		});

		it('still binds an item whose need is already fully met', () => {
			// The POST handler uses this map to stamp campaign_id. Dropping a met item here
			// would leave a booking unbound and invisible to the quota counter.
			const { itemCampaign } = computeNeeds(
				[campaign('c1', [need('item:rice', '100')])],
				[donation('donation:1', 'c1', 'declared', [{ item_id: 'item:rice', qty: '100' }])]
			);
			expect(itemCampaign.get('item:rice')).toBe('c1');
		});
	});

	it('returns empty maps when there are no campaigns', () => {
		const { remaining, itemCampaign } = computeNeeds(
			[],
			[donation('donation:1', 'c1', 'declared', [{ item_id: 'item:rice', qty: '10' }])]
		);
		expect(remaining.size).toBe(0);
		expect(itemCampaign.size).toBe(0);
	});
});

describe('pickCampaignForItems', () => {
	/**
	 * The bug this exists for: two open campaigns both want rice, the board sums them
	 * into one headline figure, but a donation carries a single campaign_id. Binding to
	 * whichever campaign came first meant a donor was shown 590 kg of headroom, asked
	 * for 200, and was refused — while the other campaign sat on 500 nobody could reach.
	 */
	function pick(campaigns: DonationCampaign[], items: { item_id?: string; qty: string }[]) {
		const { campaignRemaining } = computeNeeds(campaigns, []);
		return pickCampaignForItems(campaignRemaining, items);
	}

	it('skips a campaign that cannot take the amount and uses one that can', () => {
		const result = pick(
			[campaign('c1', [need('item:rice', '90')]), campaign('c2', [need('item:rice', '500')])],
			[{ item_id: 'item:rice', qty: '200' }]
		);
		expect(result).toEqual({ ok: true, campaignId: 'c2' });
	});

	it('still prefers the earlier campaign when it can take the amount', () => {
		// Older campaigns fill first; the fallback must not reorder normal bookings.
		const result = pick(
			[campaign('c1', [need('item:rice', '300')]), campaign('c2', [need('item:rice', '500')])],
			[{ item_id: 'item:rice', qty: '200' }]
		);
		expect(result).toEqual({ ok: true, campaignId: 'c1' });
	});

	it('accepts a request that exactly fills a campaign', () => {
		const result = pick(
			[campaign('c1', [need('item:rice', '90')])],
			[{ item_id: 'item:rice', qty: '90' }]
		);
		expect(result).toEqual({ ok: true, campaignId: 'c1' });
	});

	it('refuses when the total is only reachable by splitting across campaigns', () => {
		// 90 + 500 = 590 on the board, but no single booking can draw on both.
		const result = pick(
			[campaign('c1', [need('item:rice', '90')]), campaign('c2', [need('item:rice', '500')])],
			[{ item_id: 'item:rice', qty: '550' }]
		);
		expect(result).toEqual({ ok: false, itemId: 'item:rice' });
	});

	it('needs one campaign to cover every item in the request', () => {
		// c1 has the rice but no water; c2 has both, so c2 wins.
		const result = pick(
			[
				campaign('c1', [need('item:rice', '500')]),
				campaign('c2', [need('item:rice', '500'), need('item:water', '100')])
			],
			[
				{ item_id: 'item:rice', qty: '10' },
				{ item_id: 'item:water', qty: '10' }
			]
		);
		expect(result).toEqual({ ok: true, campaignId: 'c2' });
	});

	it('refuses when no campaign carries the whole basket', () => {
		const result = pick(
			[campaign('c1', [need('item:rice', '500')]), campaign('c2', [need('item:water', '100')])],
			[
				{ item_id: 'item:rice', qty: '10' },
				{ item_id: 'item:water', qty: '10' }
			]
		);
		expect(result.ok).toBe(false);
	});

	it('leaves free-text donations unbound, as before', () => {
		const result = pick([campaign('c1', [need('item:rice', '500')])], [{ qty: '5' }]);
		expect(result).toEqual({ ok: true, campaignId: null });
	});

	it('leaves an item no open campaign asks for unbound', () => {
		const result = pick(
			[campaign('c1', [need('item:rice', '500')])],
			[{ item_id: 'item:blanket', qty: '5' }]
		);
		expect(result).toEqual({ ok: true, campaignId: null });
	});

	it('will not route a donation into a need staff closed', () => {
		const result = pick(
			[
				campaign('c1', [need('item:rice', '500', 'closed')]),
				campaign('c2', [need('item:rice', '500')])
			],
			[{ item_id: 'item:rice', qty: '10' }]
		);
		expect(result).toEqual({ ok: true, campaignId: 'c2' });
	});
});

describe('on-hand stock (T-22 cut-off)', () => {
	function ledger(item_id: string, qty: string, extra: Partial<StockLedger> = {}): StockLedger {
		return {
			...BASE,
			_id: `stock_ledger:${item_id}:${qty}`,
			type: 'stock_ledger',
			item_id,
			qty,
			reason: 'donation',
			ref_id: null,
			...extra
		} as StockLedger;
	}

	it('counts what the warehouse already holds against the target', () => {
		// The bug this closes: a shelter sitting on 540 kg against a 500 kg target still
		// shouted "ด่วน! ขาด 450 กก." on the public board while its own staff screen
		// showed FULL, because only this side ignored the ledger.
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '500')])],
			[],
			[ledger('item:rice', '540')]
		);
		expect(remaining.get('item:rice')).toBe('-40');
	});

	it('adds on-hand and reserved the way the back-office board does', () => {
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '500')])],
			[donation('donation:1', 'c1', 'declared', [{ item_id: 'item:rice', qty: '50' }])],
			[ledger('item:rice', '300')]
		);
		expect(remaining.get('item:rice')).toBe('150');
	});

	it('does not count a received donation twice once the ledger carries it', () => {
		// 100 kg arrived and was booked in. It is on the shelf, not still owed.
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '500')])],
			[donation('donation:1', 'c1', 'received', [{ item_id: 'item:rice', qty: '100' }])],
			[ledger('item:rice', '100', { ref_id: 'donation:1' })]
		);
		expect(remaining.get('item:rice')).toBe('400');
	});

	it('still owes a received donation the ledger has not recorded yet', () => {
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '500')])],
			[donation('donation:1', 'c1', 'received', [{ item_id: 'item:rice', qty: '100' }])],
			[]
		);
		expect(remaining.get('item:rice')).toBe('400');
	});

	it('lets issues out of the warehouse reopen a need', () => {
		// Distributing stock out is a negative ledger row (T-22 "เปิดรับใหม่อัตโนมัติ").
		const { remaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '500')])],
			[],
			[ledger('item:rice', '500'), ledger('item:rice', '-120', { reason: 'distribute' })]
		);
		expect(remaining.get('item:rice')).toBe('120');
	});

	it('keeps a booking out when the warehouse already covers the target', () => {
		const { campaignRemaining } = computeNeeds(
			[campaign('c1', [need('item:rice', '500')])],
			[],
			[ledger('item:rice', '540')]
		);
		expect(pickCampaignForItems(campaignRemaining, [{ item_id: 'item:rice', qty: '10' }])).toEqual({
			ok: false,
			itemId: 'item:rice'
		});
	});
});
