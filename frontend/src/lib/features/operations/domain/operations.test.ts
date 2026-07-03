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
	createReceiveEntry,
	type Donation,
	type ReceiveSource
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
				items: [{ item_id: 'item:water', qty: 100, unit: 'ขวด' }]
			}
		];
		const remaining = openNeeds(campaign, donations);
		// water fully covered → dropped; rice untouched → remains
		expect(remaining).toHaveLength(1);
		expect(remaining[0].item_id).toBe('item:rice');
		expect(remaining[0].qty_target).toBe(50);
	});
});

describe('createReceiveEntry', () => {
	it('mints positive receive ledger entry for purchase source', () => {
		const entry = createReceiveEntry(
			{
				item_id: 'item:rice',
				qty: 10,
				unit: 'kg',
				source: 'purchase',
				ref_id: null
			},
			ctx
		);
		expect(entry.type).toBe('stock_ledger');
		expect(entry.qty).toBe(10);
		expect(entry.reason).toBe('receive');
		expect(entry.shelter_code).toBe(ctx.shelterCode);
	});

	it('maps sources to correct reasons', () => {
		const sourcesAndReasons = {
			donation: 'donation',
			purchase: 'receive',
			transfer_in: 'transfer_in',
			manual: 'adjust'
		} as const;

		for (const [source, reason] of Object.entries(sourcesAndReasons)) {
			const entry = createReceiveEntry(
				{
					item_id: 'item:rice',
					qty: 5,
					unit: 'kg',
					source: source as ReceiveSource,
					ref_id: null
				},
				ctx
			);
			expect(entry.reason).toBe(reason);
		}
	});

	it('rejects zero quantity', () => {
		expect(() =>
			createReceiveEntry(
				{
					item_id: 'item:rice',
					qty: 0,
					unit: 'kg',
					source: 'purchase',
					ref_id: null
				},
				ctx
			)
		).toThrow();
	});

	it('rejects negative quantity', () => {
		expect(() =>
			createReceiveEntry(
				{
					item_id: 'item:rice',
					qty: -5,
					unit: 'kg',
					source: 'purchase',
					ref_id: null
				},
				ctx
			)
		).toThrow();
	});

	it('accepts optional lot.expiry and lot.note', () => {
		const entry = createReceiveEntry(
			{
				item_id: 'item:rice',
				qty: 10,
				unit: 'kg',
				source: 'purchase',
				ref_id: null,
				lot: {
					expiry: '2026-12-31T00:00:00Z',
					note: 'Zone A'
				}
			},
			ctx
		);
		expect(entry.lot).toEqual({
			expiry: '2026-12-31T00:00:00Z',
			note: 'Zone A'
		});
	});

	it('accepts empty lot', () => {
		const entry = createReceiveEntry(
			{
				item_id: 'item:rice',
				qty: 10,
				unit: 'kg',
				source: 'purchase',
				ref_id: null
			},
			ctx
		);
		expect(entry.lot).toBeUndefined();
	});

	it('permits missing lot.expiry for perishable items (validation is deferred to UI layer)', () => {
		// INVARIANT: caller (UI) must enforce perishable -> lot.expiry required.
		// Domain layer doesn't have SupplyItem catalog access to check if it's perishable.
		// We explicitly verify that the domain layer allows it.
		const entry = createReceiveEntry(
			{
				item_id: 'item:milk', // Pretend milk is perishable
				qty: 5,
				unit: 'ขวด',
				source: 'purchase',
				ref_id: null
				// missing lot.expiry
			},
			ctx
		);
		expect(entry.lot).toBeUndefined();
	});
});
