import { describe, it, expect } from 'vitest';
import { computeNeeds } from './compute-needs';
import type {
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

	it('does not yet honour a per-item needs[].status of closed', () => {
		// KNOWN GAP, not desired behaviour. CR-052 adds needs[].status so staff can force
		// cut-off a single item (T-22 §1.6), but this function walks every need regardless,
		// so a closed item still reports as open and stays bookable. Change this test
		// together with the fix.
		const { remaining } = computeNeeds([campaign('c1', [need('item:rice', '100', 'closed')])], []);
		expect(remaining.get('item:rice')).toBe('100');
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
