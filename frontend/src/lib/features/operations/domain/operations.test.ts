import { describe, it, expect } from 'vitest';
import {
	createWalkInDonation,
	receiveDonation,
	expireDonation,
	canTransitionDonation,
	keyDonationReceipt,
	createStockLedger,
	stockBalance,
	createCampaign,
	openNeeds,
	isNeedCutOff,
	type Donation
} from './operations';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff1' };

function declaredItemsDonation(): Donation {
	return createWalkInDonation(
		{
			donor: { name: 'ผู้ใจบุญ', phone: '0800000000', phone_hash: 'hash' },
			kind: 'items',
			items: [{ item_id: 'item:rice', qty: 10, unit: 'kg' }],
			tracking_token_hash: 'tok'
		},
		ctx
	);
}

describe('donation lifecycle (forward-only)', () => {
	it('starts declared with a TTL and no received_at', () => {
		const d = declaredItemsDonation();
		expect(d.status).toBe('declared');
		expect(d.received_at).toBeNull();
		expect(Date.parse(d.expires_at)).toBeGreaterThan(Date.parse(d.declared_at));
	});

	it('allows declared → received/expired/cancelled only forward', () => {
		expect(canTransitionDonation('declared', 'received')).toBe(true);
		expect(canTransitionDonation('received', 'declared')).toBe(false);
		expect(canTransitionDonation('received', 'expired')).toBe(false);
	});

	it('receiveDonation moves lifecycle but creates NO stock', () => {
		const received = receiveDonation(declaredItemsDonation());
		expect(received.status).toBe('received');
		expect(received.received_at).not.toBeNull();
		// receiving returns a donation doc only — never a ledger entry
		expect('item_id' in received).toBe(false);
	});

	it('refuses to receive a non-declared donation', () => {
		const received = receiveDonation(declaredItemsDonation());
		expect(() => receiveDonation(received)).toThrow();
		expect(() => expireDonation(received)).toThrow();
	});
});

describe('keyDonationReceipt — the only donation→stock path', () => {
	it('mints one positive receive ledger entry per counted line, referencing the donation', () => {
		const donation = receiveDonation(declaredItemsDonation());
		// staff counted 8kg actually arrived, not the declared 10kg
		const ledger = keyDonationReceipt(
			donation,
			[{ item_id: 'item:rice', qty: 8, unit: 'kg' }],
			ctx
		);
		expect(ledger).toHaveLength(1);
		expect(ledger[0].type).toBe('stock_ledger');
		expect(ledger[0].qty).toBe(8); // physical count, not declared 10
		expect(ledger[0].reason).toBe('donation');
		expect(ledger[0].ref_id).toBe(donation._id);
	});
});

describe('stockBalance', () => {
	it('sums signed deltas per item', () => {
		const ledger = [
			createStockLedger({ item_id: 'item:rice', qty: 10, unit: 'kg', reason: 'receive' }, ctx),
			createStockLedger({ item_id: 'item:rice', qty: -3, unit: 'kg', reason: 'distribute' }, ctx),
			createStockLedger({ item_id: 'item:water', qty: 5, unit: 'ขวด', reason: 'receive' }, ctx)
		];
		const balance = stockBalance(ledger);
		expect(balance.get('item:rice')).toBe(7);
		expect(balance.get('item:water')).toBe(5);
	});

	it('rejects a zero-quantity ledger entry', () => {
		expect(() =>
			createStockLedger({ item_id: 'item:rice', qty: 0, unit: 'kg', reason: 'adjust' }, ctx)
		).toThrow();
	});
});

describe('openNeeds', () => {
	it('subtracts active donations and drops satisfied needs', () => {
		const campaign = createCampaign(
			{
				title: 'น้ำดื่ม',
				needs: [
					{ item_id: 'item:water', qty_target: 100, unit: 'ขวด' },
					{ item_id: 'item:rice', qty_target: 50, unit: 'kg' }
				]
			},
			ctx
		);
		const donations: Donation[] = [
			{
				...declaredItemsDonation(),
				campaign_id: campaign._id,
				status: 'declared',
				items: [{ item_id: 'item:water', qty: 100, unit: 'ขวด' }]
			}
		];
		const remaining = openNeeds(campaign, donations, []);
		// water fully covered → dropped; rice untouched → remains
		expect(remaining).toHaveLength(1);
		expect(remaining[0].item_id).toBe('item:rice');
		expect(remaining[0].qty_target).toBe(50);
	});

	it('subtracts on-hand stock and active reservations correctly', () => {
		const campaign = createCampaign(
			{
				title: 'ของยังชีพ',
				needs: [
					{ item_id: 'item:water', qty_target: 100, unit: 'ขวด' },
					{ item_id: 'item:rice', qty_target: 50, unit: 'kg' }
				]
			},
			ctx
		);

		const stockLedgers = [
			createStockLedger({ item_id: 'item:water', qty: 30, unit: 'ขวด', reason: 'receive' }, ctx)
		];

		const donations: Donation[] = [
			{
				...declaredItemsDonation(),
				campaign_id: campaign._id,
				status: 'declared',
				items: [{ item_id: 'item:water', qty: 40, unit: 'ขวด' }]
			}
		];

		const remaining = openNeeds(campaign, donations, stockLedgers);

		expect(remaining).toHaveLength(2);
		const waterNeed = remaining.find(r => r.item_id === 'item:water');
		expect(waterNeed?.qty_target).toBe(30);
	});
});


describe('Donation Cut-off (T-22) threshold crossing', () => {
	it('Should automatically cut off when On-hand + Reserved >= Target', () => {
		// Case A: Total is less than target (On-hand 40 + Reserved 50 = 90 < 100) -> Still open (false)
		expect(isNeedCutOff(100, 40, 50, 'open')).toBe(false);

		// Case B: Total equals the target exactly (On-hand 50 + Reserved 50 = 100 >= 100) -> Cut off immediately (true)
		expect(isNeedCutOff(100, 50, 50, 'open')).toBe(true);

		// Case C: Total exceeds the target (On-hand 60 + Reserved 50 = 110 >= 100) -> Cut off immediately (true)
		expect(isNeedCutOff(100, 60, 50, 'open')).toBe(true);
	});

	it('Should automatically reopen when inventory drops below target due to distribution', () => {
		// First: Inventory exceeds target (On-hand 120 + Reserved 0 >= 100) -> Cut off (true)
		expect(isNeedCutOff(100, 120, 0, 'open')).toBe(true);

		// Later: Staff distributed items to evacuees, leaving 80 items (On-hand 80 + Reserved 0 < 100) -> Must reopen (false)
		expect(isNeedCutOff(100, 80, 0, 'open')).toBe(false);
	});

	it('Should always remain closed if the campaign is manually closed (Manual Override)', () => {
		// Even if the total is below target (On-hand 10 + Reserved 10 = 20 < 100), but campaign status is 'closed' -> Must cut off (true)
		expect(isNeedCutOff(100, 10, 10, 'closed')).toBe(true);
	});
});