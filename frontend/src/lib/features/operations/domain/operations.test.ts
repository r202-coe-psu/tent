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
	calculateReserved,
	isNeedCutOff,
	deriveNeedAvailability,
	createReceiveEntry,
	createDistributeEntry,
	createTransfer,
	dispatchTransfer,
	receiveTransfer,
	mapNeedItemHeuristic,
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
		const waterNeed = remaining.find((r) => r.item_id === 'item:water');
		expect(waterNeed?.qty_target).toBe(30);
	});

	it('filters out closed needs and closed campaigns', () => {
		const campaign = createCampaign(
			{
				title: 'ของยังชีพ',
				needs: [
					{ item_id: 'item:water', qty_target: 100, unit: 'ขวด', status: 'closed' },
					{ item_id: 'item:rice', qty_target: 50, unit: 'kg', status: 'open' }
				]
			},
			ctx
		);

		const remaining = openNeeds(campaign, [], []);
		// item:water is closed -> dropped; item:rice is open -> remains
		expect(remaining).toHaveLength(1);
		expect(remaining[0].item_id).toBe('item:rice');

		// If the entire campaign is closed
		const closedCampaign = {
			...campaign,
			status: 'closed' as const
		};
		const remainingClosed = openNeeds(closedCampaign, [], []);
		expect(remainingClosed).toHaveLength(0);
	});
});

describe('calculateReserved', () => {
	it('sums declared and unkeyed received donations, ignoring keyed, expired, cancelled, or mismatched campaigns', () => {
		const campaignA = 'camp-A';
		const campaignB = 'camp-B';

		// 1. Declared donation for Campaign A
		const donationDeclared: Donation = {
			...declaredItemsDonation(),
			_id: 'don:declared-A',
			campaign_id: campaignA,
			status: 'declared',
			items: [{ item_id: 'item:water', qty: 50, unit: 'ขวด' }]
		};

		// 2. Unkeyed received donation for Campaign A
		const donationUnkeyedReceived: Donation = {
			...declaredItemsDonation(),
			_id: 'don:unkeyed-A',
			campaign_id: campaignA,
			status: 'received',
			items: [{ item_id: 'item:water', qty: 30, unit: 'ขวด' }]
		};

		// 3. Keyed received donation for Campaign A (has ledger entry)
		const donationKeyedReceived: Donation = {
			...declaredItemsDonation(),
			_id: 'don:keyed-A',
			campaign_id: campaignA,
			status: 'received',
			items: [{ item_id: 'item:water', qty: 20, unit: 'ขวด' }]
		};

		// 4. Mismatched campaign donation
		const donationOtherCampaign: Donation = {
			...declaredItemsDonation(),
			_id: 'don:other-B',
			campaign_id: campaignB,
			status: 'declared',
			items: [{ item_id: 'item:water', qty: 100, unit: 'ขวด' }]
		};

		// 5. Expired donation
		const donationExpired: Donation = {
			...declaredItemsDonation(),
			_id: 'don:expired-A',
			campaign_id: campaignA,
			status: 'expired',
			items: [{ item_id: 'item:water', qty: 40, unit: 'ขวด' }]
		};

		// 6. Cancelled donation
		const donationCancelled: Donation = {
			...declaredItemsDonation(),
			_id: 'don:cancelled-A',
			campaign_id: campaignA,
			status: 'cancelled',
			items: [{ item_id: 'item:water', qty: 40, unit: 'ขวด' }]
		};

		const donations = [
			donationDeclared,
			donationUnkeyedReceived,
			donationKeyedReceived,
			donationOtherCampaign,
			donationExpired,
			donationCancelled
		];

		// Ledger indicating that donationKeyedReceived has been keyed
		const stockLedgers = [
			createStockLedger(
				{
					item_id: 'item:water',
					qty: 20,
					unit: 'ขวด',
					reason: 'donation',
					ref_id: 'don:keyed-A'
				},
				ctx
			)
		];

		// When campaignId matches campaignA
		const reservedA = calculateReserved(donations, stockLedgers, campaignA);
		// Should include declared (50) + unkeyed received (30) = 80
		expect(reservedA.get('item:water')).toBe(80);

		// When campaignId matches campaignB
		const reservedB = calculateReserved(donations, stockLedgers, campaignB);
		expect(reservedB.get('item:water')).toBe(100);

		// When no campaignId is passed, should sum all campaigns
		const reservedAll = calculateReserved(donations, stockLedgers);
		// Should include campaignA (80) + campaignB (100) = 180
		expect(reservedAll.get('item:water')).toBe(180);
	});
});

describe('Donation Cut-off (T-22) threshold crossing', () => {
	it('Should automatically cut off when On-hand + Reserved >= Target', () => {
		// Case A: Total is less than target (On-hand 40 + Reserved 50 = 90 < 100) -> Still open (false)
		expect(isNeedCutOff(100, 40, 50, 'open', 'open')).toBe(false);

		// Case B: Total equals the target exactly (On-hand 50 + Reserved 50 = 100 >= 100) -> Cut off immediately (true)
		expect(isNeedCutOff(100, 50, 50, 'open', 'open')).toBe(true);

		// Case C: Total exceeds the target (On-hand 60 + Reserved 50 = 110 >= 100) -> Cut off immediately (true)
		expect(isNeedCutOff(100, 60, 50, 'open', 'open')).toBe(true);
	});

	it('Should automatically reopen when inventory drops below target due to distribution', () => {
		// First: Inventory exceeds target (On-hand 120 + Reserved 0 >= 100) -> Cut off (true)
		expect(isNeedCutOff(100, 120, 0, 'open', 'open')).toBe(true);

		// Later: Staff distributed items to evacuees, leaving 80 items (On-hand 80 + Reserved 0 < 100) -> Must reopen (false)
		expect(isNeedCutOff(100, 80, 0, 'open', 'open')).toBe(false);
	});

	it('Should always remain closed if the campaign or the need is manually closed (Manual Override)', () => {
		// Case A: Campaign status is 'closed', need status is 'open' -> Must cut off (true)
		expect(isNeedCutOff(100, 10, 10, 'open', 'closed')).toBe(true);

		// Case B: Campaign status is 'open', need status is 'closed' -> Must cut off (true)
		expect(isNeedCutOff(100, 10, 10, 'closed', 'open')).toBe(true);

		// Case C: Both are closed -> Must cut off (true)
		expect(isNeedCutOff(100, 10, 10, 'closed', 'closed')).toBe(true);
	});
});

describe('deriveNeedAvailability', () => {
	it('correctly maps campaign needs to their availability status', () => {
		const campaign = createCampaign(
			{
				title: 'ของยังชีพ',
				needs: [
					{ item_id: 'item:water', qty_target: 100, unit: 'ขวด', status: 'open' },
					{ item_id: 'item:rice', qty_target: 50, unit: 'kg', status: 'open' }
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

		const availability = deriveNeedAvailability(campaign, donations, stockLedgers);
		expect(availability).toHaveLength(2);

		const waterAvail = availability.find((a) => a.item_id === 'item:water');
		expect(waterAvail).toBeDefined();
		expect(waterAvail?.qty_on_hand).toBe(30);
		expect(waterAvail?.qty_reserved).toBe(40);
		expect(waterAvail?.qty_remaining).toBe(30);
		expect(waterAvail?.is_cut_off).toBe(false);

		const riceAvail = availability.find((a) => a.item_id === 'item:rice');
		expect(riceAvail).toBeDefined();
		expect(riceAvail?.qty_on_hand).toBe(0);
		expect(riceAvail?.qty_reserved).toBe(0);
		expect(riceAvail?.qty_remaining).toBe(50);
		expect(riceAvail?.is_cut_off).toBe(false);
	});
});

describe('createReceiveEntry', () => {
	it('maps sources to correct reasons', () => {
		const sourcesAndReasons = {
			donation: 'donation',
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
					source: 'donation',
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
					source: 'donation',
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
				source: 'donation',
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
				source: 'donation',
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
				source: 'donation',
				ref_id: null
				// missing lot.expiry
			},
			ctx
		);
		expect(entry.lot).toBeUndefined();
	});
});

describe('createDistributeEntry', () => {
	it('creates valid distribute entry with negative qty and distribute reason', () => {
		const entry = createDistributeEntry(
			{
				item_id: 'item:water',
				qty: 5,
				unit: 'ขวด',
				ref_id: null,
				note: 'Zone B'
			},
			ctx
		);

		expect(entry.type).toBe('stock_ledger');
		expect(entry.item_id).toBe('item:water');
		expect(entry.qty).toBe(-5); // Must be negative
		expect(entry.reason).toBe('distribute');
		expect(entry.lot).toEqual({ note: 'Zone B' });
		expect(entry.shelter_code).toBe(ctx.shelterCode);
	});

	it('creates entry without note when omitted', () => {
		const entry = createDistributeEntry(
			{
				item_id: 'item:rice',
				qty: 10,
				unit: 'kg',
				ref_id: null
			},
			ctx
		);

		expect(entry.qty).toBe(-10);
		expect(entry.lot).toBeUndefined();
	});

	it('rejects zero or negative quantity inputs', () => {
		expect(() =>
			createDistributeEntry(
				{
					item_id: 'item:water',
					qty: 0,
					unit: 'ขวด',
					ref_id: null
				},
				ctx
			)
		).toThrow();

		expect(() =>
			createDistributeEntry(
				{
					item_id: 'item:water',
					qty: -5,
					unit: 'ขวด',
					ref_id: null
				},
				ctx
			)
		).toThrow();
	});
});

describe('Inter-shelter Transfers', () => {
	it('creates and dispatches a transfer', () => {
		const t = createTransfer(
			{
				from_shelter: 'SH001',
				to_shelter: 'SH002',
				items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
			},
			ctx
		);
		expect(t.status).toBe('requested');

		const { transfer: shipped, ledgers } = dispatchTransfer(t, ctx);
		expect(shipped.status).toBe('shipped');
		expect(shipped.timeline.shipped).toBeDefined();
		expect(ledgers).toHaveLength(1);
		expect(ledgers[0].qty).toBe(-100); // outbound
		expect(ledgers[0].reason).toBe('transfer_out');
	});

	it('receives a transfer completely', () => {
		const t = createTransfer(
			{
				from_shelter: 'SH001',
				to_shelter: 'SH002',
				items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
			},
			ctx
		);
		const { transfer: shipped } = dispatchTransfer(t, ctx);

		const { transfer: received, ledgers } = receiveTransfer(
			shipped,
			[{ item_id: 'item:rice', qty: 100 }],
			ctx
		);

		expect(received.status).toBe('received');
		expect(received.items[0].received_qty).toBe(100);
		expect(ledgers).toHaveLength(1);
		expect(ledgers[0].qty).toBe(100);
		expect(ledgers[0].reason).toBe('transfer_in');
	});

	it('handles partial receipt (loss in transit)', () => {
		const t = createTransfer(
			{
				from_shelter: 'SH001',
				to_shelter: 'SH002',
				items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
			},
			ctx
		);
		const { transfer: shipped } = dispatchTransfer(t, ctx);

		// Receiver only gets 85
		const { transfer: received, ledgers } = receiveTransfer(
			shipped,
			[{ item_id: 'item:rice', qty: 85 }],
			ctx
		);

		expect(received.status).toBe('received');
		expect(received.items[0].received_qty).toBe(85);
		expect(ledgers).toHaveLength(1);
		expect(ledgers[0].qty).toBe(85); // Only 85 added to inventory
		expect(ledgers[0].reason).toBe('transfer_in');
	});

	it('handles zero receipt (complete loss)', () => {
		const t = createTransfer(
			{
				from_shelter: 'SH001',
				to_shelter: 'SH002',
				items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
			},
			ctx
		);
		const { transfer: shipped } = dispatchTransfer(t, ctx);

		// Receiver gets 0
		const { transfer: received, ledgers } = receiveTransfer(
			shipped,
			[{ item_id: 'item:rice', qty: 0 }],
			ctx
		);

		expect(received.status).toBe('received');
		expect(received.items[0].received_qty).toBe(0);
		expect(ledgers).toHaveLength(0); // No ledger entry since nothing was added
	});
});

describe('mapNeedItemHeuristic', () => {
	it('maps known items correctly', () => {
		expect(mapNeedItemHeuristic('ข้าวสารหอมมะลิ')).toBe('item:rice');
		expect(mapNeedItemHeuristic('น้ำดื่มสะอาด')).toBe('item:water');
		expect(mapNeedItemHeuristic('ยาพาราเซตามอล')).toBe('item:paracetamol');
		expect(mapNeedItemHeuristic('สบู่ถูตัว')).toBe('item:soap');
		expect(mapNeedItemHeuristic('ผ้าห่มกันหนาว')).toBe('item:blanket');
		expect(mapNeedItemHeuristic('ไข่ไก่สด')).toBe('item:egg');
	});

	it('slugs unknown items correctly', () => {
		expect(mapNeedItemHeuristic('ปลากระป๋องรสเผ็ด')).toBe('item:ปลากระป๋องรสเผ็ด');
		expect(mapNeedItemHeuristic('  Spoons & Forks  ')).toBe('item:spoons-forks');
	});
});
