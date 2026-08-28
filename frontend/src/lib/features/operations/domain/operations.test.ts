import { describe, it, expect } from 'vitest';
import {
	createWalkInDonation,
	receiveDonation,
	expireDonation,
	canTransitionDonation,
	keyDonationReceipt,
	createStockLedger,
	stockLedgerInputSchema,
	parseStockLedger,
	ledgerReasonSchema,
	stockBalance,
	createCampaign,
	openNeeds,
	calculateReserved,
	keyedDonationIds,
	keyableDonations,
	isNeedCutOff,
	forceCutOffNeed,
	reopenNeed,
	isDonationOutstanding,
	deriveNeedAvailability,
	createReceiveEntry,
	createDistributeEntry,
	createPurchase,
	keyPurchaseReceipt,
	purchaseReceiptStatus,
	canEditPurchase,
	purchaseReceiptInputSchema,
	isPurchase,
	mapNeedItemHeuristic,
	nextLotNos,
	lotDateStamp,
	stockLotSchema,
	type Donation,
	type LedgerReason,
	type ReceiveSource
} from './operations';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff1' };

// CR-055 R2: a 'donation' receipt must point at a real donation doc, so fixtures
// that only need stock on hand still have to name one.
const DONATION_REF = 'donation:01JFIXTUREDONATION';

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

	// CR-087 — redirecting hands the request to another shelter, and is terminal on
	// THIS doc: the destination continues on its own `donation_redirect` ticket.
	it('allows pending_review → redirected only, and never leaves redirected', () => {
		expect(canTransitionDonation('pending_review', 'redirected')).toBe(true);
		expect(canTransitionDonation('declared', 'redirected')).toBe(false);
		expect(canTransitionDonation('verifying', 'redirected')).toBe(false);
		expect(canTransitionDonation('received', 'redirected')).toBe(false);
		expect(canTransitionDonation('redirected', 'received')).toBe(false);
		expect(canTransitionDonation('redirected', 'pending_review')).toBe(false);
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
			[{ item_id: 'item:rice', qty: '8', unit: 'kg' }],
			ctx
		);
		expect(ledger).toHaveLength(1);
		expect(ledger[0].type).toBe('stock_ledger');
		expect(ledger[0].qty).toBe('8'); // physical count, not declared 10
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
		expect(balance.get('item:rice')).toBe('7');
		expect(balance.get('item:water')).toBe('5');
	});

	it('rounds float residue so 0.1 + 0.2 balances to 0.3', () => {
		const ledger = [
			createStockLedger({ item_id: 'item:rice', qty: 0.1, unit: 'kg', reason: 'receive' }, ctx),
			createStockLedger({ item_id: 'item:rice', qty: 0.2, unit: 'kg', reason: 'receive' }, ctx)
		];
		expect(stockBalance(ledger).get('item:rice')).toBe('0.3');
	});

	it('rejects a zero-quantity ledger entry', () => {
		expect(() =>
			createStockLedger({ item_id: 'item:rice', qty: 0, unit: 'kg', reason: 'adjust' }, ctx)
		).toThrow();
	});
});

describe('stock_ledger schema_v + reason enum (CR-032)', () => {
	// Bumped 3 → 4 by CR-088 (lot.lot_no / lot.storage_zone). Every writer goes
	// through `createStockLedger`, so one assertion covers all of them.
	it('stamps schema_v 4 on every ledger entry', () => {
		const entry = createStockLedger(
			{ item_id: 'item:rice', qty: 5, unit: 'kg', reason: 'receive' },
			ctx
		);
		expect(entry.schema_v).toBe(4);
	});

	it('accepts `purchase` as a valid reason (CR-032)', () => {
		expect(ledgerReasonSchema.safeParse('purchase').success).toBe(true);
		const entry = createStockLedger(
			{
				item_id: 'item:rice',
				qty: 5,
				unit: 'kg',
				reason: 'purchase',
				ref_id: 'purchase:01JFIXTUREPURCHASE'
			},
			ctx
		);
		expect(entry.reason).toBe('purchase');
	});

	it('rejects malformed persisted ledger documents at a signed-sum boundary', () => {
		const entry = createStockLedger(
			{ item_id: 'item:rice', qty: 5, unit: 'kg', reason: 'receive' },
			ctx
		);

		expect(parseStockLedger(entry)).toEqual(entry);
		expect(() => parseStockLedger({ ...entry, qty: 'not-a-quantity' })).toThrow();
		expect(() => parseStockLedger({ ...entry, qty: 5 })).toThrow();
		expect(() => parseStockLedger({ ...entry, type: 'donation' })).toThrow();
	});

	it('reads compatible schema_v 2 ledgers but reserves purchase for schema_v 3', () => {
		const entry = createStockLedger(
			{ item_id: 'item:rice', qty: 5, unit: 'kg', reason: 'receive' },
			ctx
		);

		expect(parseStockLedger({ ...entry, schema_v: 2 }).schema_v).toBe(2);
		expect(() => parseStockLedger({ ...entry, schema_v: 2, reason: 'purchase' })).toThrow(
			/purchase requires stock_ledger schema_v 3/
		);
	});
});

// CR-055 R1/R2/R6 — the reason ↔ ref_id table, enforced on write. Every reason
// gets both an accept and a reject case; the table below IS the spec table, so a
// new reason that is not listed here fails to compile.
describe('stock_ledger reason ↔ ref_id invariant (CR-055)', () => {
	const base = { item_id: 'item:rice', qty: 5, unit: 'kg' } as const;
	const write = (reason: LedgerReason, ref_id: string | null) =>
		createStockLedger({ ...base, reason, ref_id }, ctx);

	const cases: Record<LedgerReason, { valid: string | null; invalid: string | null }> = {
		donation: { valid: 'donation:01J', invalid: 'purchase:01J' },
		purchase: { valid: 'purchase:01J', invalid: 'donation:01J' },
		requisition: { valid: 'kitchen_requisition:01J', invalid: 'donation:01J' },
		transfer_in: { valid: 'stock_transfer:01J', invalid: 'transfer:01J' },
		transfer_out: { valid: 'stock_transfer:01J', invalid: null },
		adjust: { valid: null, invalid: 'donation:01J' },
		distribute: { valid: null, invalid: 'donation:01J' },
		receive: { valid: null, invalid: 'donation:01J' }
	};

	for (const [reason, { valid, invalid }] of Object.entries(cases) as [
		LedgerReason,
		{ valid: string | null; invalid: string | null }
	][]) {
		it(`accepts ${reason} with ${valid ?? 'no'} ref_id`, () => {
			expect(write(reason, valid).ref_id).toBe(valid);
		});

		it(`rejects ${reason} with ${invalid ?? 'no'} ref_id`, () => {
			expect(() => write(reason, invalid)).toThrow();
		});
	}

	it('rejects a reason that requires a ref_id when none is given', () => {
		expect(() => createStockLedger({ ...base, reason: 'donation' }, ctx)).toThrow();
	});

	it('reports the failure on the ref_id field so forms can show it inline', () => {
		const result = stockLedgerInputSchema.safeParse({ ...base, reason: 'adjust', ref_id: 'x:1' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0].path).toEqual(['ref_id']);
	});

	// R5 — the guard is write-only. Rows written before it existed still have to
	// flow through the read paths untouched.
	it('still sums a pre-existing row that violates the invariant', () => {
		const legal = write('receive', null);
		const illegal = {
			...legal,
			_id: 'stock_ledger:legacy',
			reason: 'adjust' as const,
			ref_id: 'x:1'
		};
		expect(stockBalance([legal, illegal]).get('item:rice')).toBe('10');
	});

	it('still reserves against a legacy donation row whose ref_id is malformed', () => {
		// pre-invariant rows used a truncated prefix; `calculateReserved` must keep
		// reading them rather than throwing or silently dropping the donation
		const donation: Donation = {
			...declaredItemsDonation(),
			_id: 'donation:legacy-A',
			status: 'received',
			items: [{ item_id: 'item:water', qty: '20', unit: 'ขวด' }]
		};
		const malformed = {
			...write('receive', null),
			reason: 'donation' as const,
			ref_id: 'don:legacy-A'
		};

		// the malformed pointer does not match the donation, so it stays unkeyed
		expect(calculateReserved([donation], [malformed]).get('item:water')).toBe('20');
		// and the read path did not throw on the way through
		expect(keyedDonationIds([malformed]).has('don:legacy-A')).toBe(true);
	});
});

describe('purchase — createPurchase + keyPurchaseReceipt (CR-032)', () => {
	it('creates a purchase doc (schema_v 1) carrying vendor and planning items', () => {
		const purchase = createPurchase(
			{
				vendor: 'ACME',
				po_ref: 'PO-1',
				items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
			},
			ctx
		);
		expect(purchase.type).toBe('purchase');
		expect(purchase.schema_v).toBe(1);
		expect(purchase._id.startsWith('purchase:')).toBe(true);
		expect(purchase.vendor).toBe('ACME');
		expect(purchase.po_ref).toBe('PO-1');
		expect(purchase.items[0].qty).toBe('100'); // persisted as qty_str
		expect(isPurchase(purchase)).toBe(true);
	});

	it('omits po_ref and note when they are not supplied', () => {
		const purchase = createPurchase(
			{ vendor: 'ACME', items: [{ item_id: 'item:rice', qty: 1, unit: 'kg' }] },
			ctx
		);
		expect(purchase.po_ref).toBeUndefined();
		expect(purchase.note).toBeUndefined();
	});

	it('mints one purchase ledger entry per counted line, referencing the purchase', () => {
		const purchase = createPurchase(
			{ vendor: 'ACME', items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }] },
			ctx
		);
		const ledger = keyPurchaseReceipt(
			purchase,
			[{ item_id: 'item:rice', qty: '90', unit: 'kg' }],
			ctx
		);
		expect(ledger).toHaveLength(1);
		expect(ledger[0].reason).toBe('purchase');
		expect(ledger[0].ref_id).toBe(purchase._id);
		expect(ledger[0].qty).toBe('90'); // counted, not the planned 100
		expect(ledger[0].schema_v).toBe(4); // CR-088 bumped the ledger to 4
	});

	it('rejects a purchase without a vendor or without items', () => {
		expect(() =>
			createPurchase({ vendor: '', items: [{ item_id: 'item:rice', qty: 1, unit: 'kg' }] }, ctx)
		).toThrow();
		expect(() => createPurchase({ vendor: 'ACME', items: [] }, ctx)).toThrow();
	});
});

// schema.md §2.16 — the receipt status is derived from the ledger, never stored,
// so the badge can't drift from the balance shown beside it (T-14 DoD).
describe('purchaseReceiptStatus + canEditPurchase (CR-032)', () => {
	const twoLinePurchase = () =>
		createPurchase(
			{
				vendor: 'ACME',
				items: [
					{ item_id: 'item:rice', qty: 100, unit: 'kg' },
					{ item_id: 'item:sugar', qty: 20, unit: 'kg' }
				]
			},
			ctx
		);

	it('reports not_received while no ledger row points at the purchase', () => {
		const purchase = twoLinePurchase();
		expect(purchaseReceiptStatus(purchase, [])).toBe('not_received');
		expect(canEditPurchase(purchase, [])).toBe(true);
	});

	it('ignores ledger rows belonging to another purchase or another reason', () => {
		const purchase = twoLinePurchase();
		const other = keyPurchaseReceipt(
			twoLinePurchase(),
			[
				{ item_id: 'item:rice', qty: '100', unit: 'kg' },
				{ item_id: 'item:sugar', qty: '20', unit: 'kg' }
			],
			ctx
		);
		// Deliberately mismatched: reason 'donation' pointing at a purchase _id.
		// CR-055 R2 forbids writing this, so it is assembled directly rather than
		// through the factory — it stands in for a row written before the invariant
		// existed, which read paths must still tolerate (R5).
		const donationRow = {
			...createStockLedger(
				{ item_id: 'item:rice', qty: '100', unit: 'kg', reason: 'donation', ref_id: DONATION_REF },
				ctx
			),
			ref_id: purchase._id
		};
		expect(purchaseReceiptStatus(purchase, [...other, donationRow])).toBe('not_received');
	});

	it('reports partial while any ordered item is short, then received once all are met', () => {
		const purchase = twoLinePurchase();
		const firstRound = keyPurchaseReceipt(
			purchase,
			[{ item_id: 'item:rice', qty: '100', unit: 'kg' }],
			ctx
		);
		expect(purchaseReceiptStatus(purchase, firstRound)).toBe('partial');
		expect(canEditPurchase(purchase, firstRound)).toBe(false);

		const secondRound = keyPurchaseReceipt(
			purchase,
			[{ item_id: 'item:sugar', qty: '20', unit: 'kg' }],
			ctx
		);
		expect(purchaseReceiptStatus(purchase, [...firstRound, ...secondRound])).toBe('received');
	});

	it('sums multiple rounds for the same item before judging completeness', () => {
		const purchase = createPurchase(
			{ vendor: 'ACME', items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }] },
			ctx
		);
		const rows = [
			...keyPurchaseReceipt(purchase, [{ item_id: 'item:rice', qty: '40', unit: 'kg' }], ctx),
			...keyPurchaseReceipt(purchase, [{ item_id: 'item:rice', qty: '60', unit: 'kg' }], ctx)
		];
		expect(purchaseReceiptStatus(purchase, rows.slice(0, 1))).toBe('partial');
		expect(purchaseReceiptStatus(purchase, rows)).toBe('received');
	});

	it('counts receiving more than ordered as received, with no fourth state', () => {
		const purchase = createPurchase(
			{ vendor: 'ACME', items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }] },
			ctx
		);
		const rows = keyPurchaseReceipt(
			purchase,
			[{ item_id: 'item:rice', qty: '120', unit: 'kg' }],
			ctx
		);
		expect(purchaseReceiptStatus(purchase, rows)).toBe('received');
	});

	it('does not let an unordered item alone complete the purchase', () => {
		const purchase = createPurchase(
			{ vendor: 'ACME', items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }] },
			ctx
		);
		const rows = keyPurchaseReceipt(
			purchase,
			[{ item_id: 'item:soap', qty: '5', unit: 'bar' }],
			ctx
		);
		expect(purchaseReceiptStatus(purchase, rows)).toBe('partial');
	});
});

describe('purchaseReceiptInputSchema (CR-032)', () => {
	it('rejects a receipt with no counted lines', () => {
		expect(purchaseReceiptInputSchema.safeParse({ counted: [] }).success).toBe(false);
	});

	it('rejects a non-positive counted quantity', () => {
		const parsed = purchaseReceiptInputSchema.safeParse({
			counted: [{ item_id: 'item:rice', qty: 0, unit: 'kg' }]
		});
		expect(parsed.success).toBe(false);
	});

	it('coerces a numeric qty to qty_str and keeps the optional lot', () => {
		const parsed = purchaseReceiptInputSchema.parse({
			counted: [
				{
					item_id: 'item:rice',
					qty: 12.5,
					unit: 'kg',
					lot: { expiry: '2026-08-01', note: 'Zone A' }
				}
			]
		});
		expect(parsed.counted[0].qty).toBe('12.5');
		expect(parsed.counted[0].lot).toEqual({ expiry: '2026-08-01', note: 'Zone A' });
	});

	it('accepts a line without a lot — expiry is the caller’s check', () => {
		const parsed = purchaseReceiptInputSchema.parse({
			counted: [{ item_id: 'item:soap', qty: '5', unit: 'bar' }]
		});
		expect(parsed.counted[0].lot).toBeUndefined();
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
				items: [{ item_id: 'item:water', qty: '100', unit: 'ขวด' }]
			}
		];
		const remaining = openNeeds(campaign, donations, []);
		// water fully covered → dropped; rice untouched → remains
		expect(remaining).toHaveLength(1);
		expect(remaining[0].item_id).toBe('item:rice');
		expect(remaining[0].qty_target).toBe('50');
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
				items: [{ item_id: 'item:water', qty: '40', unit: 'ขวด' }]
			}
		];

		const remaining = openNeeds(campaign, donations, stockLedgers);

		expect(remaining).toHaveLength(2);
		const waterNeed = remaining.find((r) => r.item_id === 'item:water');
		expect(waterNeed?.qty_target).toBe('30');
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

// CR-055 R4 — what the receive form's picker is allowed to offer. The picker is
// the reason `ref_id` can no longer be mistyped, so the filter deciding what
// goes in it carries the same weight as the write guard itself.
describe('keyableDonations + keyedDonationIds (CR-055 R4)', () => {
	const donation = (over: Partial<Donation>): Donation => ({
		...declaredItemsDonation(),
		...over
	});

	const keyedRow = (refId: string | null, reason: LedgerReason = 'donation') => ({
		...createStockLedger(
			{
				item_id: 'item:rice',
				qty: '10',
				unit: 'kg',
				reason: 'receive' as LedgerReason,
				ref_id: null
			},
			ctx
		),
		reason,
		ref_id: refId
	});

	it('collects the donation ids that already have a donation ledger row', () => {
		const keyed = keyedDonationIds([
			keyedRow('donation:A'),
			keyedRow('purchase:P', 'purchase'),
			keyedRow(null, 'adjust')
		]);
		expect([...keyed]).toEqual(['donation:A']);
	});

	it('offers declared and unkeyed received donations', () => {
		const declared = donation({ _id: 'donation:A', status: 'declared' });
		const received = donation({ _id: 'donation:B', status: 'received' });
		const offered = keyableDonations([declared, received], []);
		expect(offered.map((d) => d._id)).toEqual(['donation:A', 'donation:B']);
	});

	it('drops a donation once a ledger row keys it', () => {
		const declared = donation({ _id: 'donation:A', status: 'declared' });
		const keyed = donation({ _id: 'donation:B', status: 'received' });
		const offered = keyableDonations([declared, keyed], [keyedRow('donation:B')]);
		expect(offered.map((d) => d._id)).toEqual(['donation:A']);
	});

	it('drops terminal donations and money donations', () => {
		const expired = donation({ _id: 'donation:A', status: 'expired' });
		const cancelled = donation({ _id: 'donation:B', status: 'cancelled' });
		const money = donation({ _id: 'donation:C', kind: 'money', items: undefined });
		expect(keyableDonations([expired, cancelled, money], [])).toEqual([]);
	});

	it('is not fooled by a ledger row pointing at another doc type', () => {
		// a `purchase` row carrying a purchase id must not un-offer a donation
		// that happens to share the suffix
		const declared = donation({ _id: 'donation:A', status: 'declared' });
		const offered = keyableDonations([declared], [keyedRow('purchase:A', 'purchase')]);
		expect(offered.map((d) => d._id)).toEqual(['donation:A']);
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
			items: [{ item_id: 'item:water', qty: '50', unit: 'ขวด' }]
		};

		// 2. Unkeyed received donation for Campaign A
		const donationUnkeyedReceived: Donation = {
			...declaredItemsDonation(),
			_id: 'donation:unkeyed-A',
			campaign_id: campaignA,
			status: 'received',
			items: [{ item_id: 'item:water', qty: '30', unit: 'ขวด' }]
		};

		// 3. Keyed received donation for Campaign A (has ledger entry)
		const donationKeyedReceived: Donation = {
			...declaredItemsDonation(),
			_id: 'donation:keyed-A',
			campaign_id: campaignA,
			status: 'received',
			items: [{ item_id: 'item:water', qty: '20', unit: 'ขวด' }]
		};

		// 4. Mismatched campaign donation
		const donationOtherCampaign: Donation = {
			...declaredItemsDonation(),
			_id: 'don:other-B',
			campaign_id: campaignB,
			status: 'declared',
			items: [{ item_id: 'item:water', qty: '100', unit: 'ขวด' }]
		};

		// 5. Expired donation
		const donationExpired: Donation = {
			...declaredItemsDonation(),
			_id: 'don:expired-A',
			campaign_id: campaignA,
			status: 'expired',
			items: [{ item_id: 'item:water', qty: '40', unit: 'ขวด' }]
		};

		// 6. Cancelled donation
		const donationCancelled: Donation = {
			...declaredItemsDonation(),
			_id: 'don:cancelled-A',
			campaign_id: campaignA,
			status: 'cancelled',
			items: [{ item_id: 'item:water', qty: '40', unit: 'ขวด' }]
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
					ref_id: 'donation:keyed-A'
				},
				ctx
			)
		];

		// When campaignId matches campaignA
		const reservedA = calculateReserved(donations, stockLedgers, campaignA);
		// Should include declared (50) + unkeyed received (30) = 80
		expect(reservedA.get('item:water')).toBe('80');

		// When campaignId matches campaignB
		const reservedB = calculateReserved(donations, stockLedgers, campaignB);
		expect(reservedB.get('item:water')).toBe('100');

		// When no campaignId is passed, should sum all campaigns
		const reservedAll = calculateReserved(donations, stockLedgers);
		// Should include campaignA (80) + campaignB (100) = 180
		expect(reservedAll.get('item:water')).toBe('180');
	});

	it('correctly maps and sums public donations without campaign_id and using free_text', () => {
		const donations: Donation[] = [
			{
				...declaredItemsDonation(),
				_id: 'don:public-1',
				campaign_id: null,
				status: 'declared',
				items: [{ free_text: 'ข้าวสาร', qty: '15', unit: 'kg' }] // Maps to item:rice
			},
			{
				...declaredItemsDonation(),
				_id: 'don:public-2',
				campaign_id: null,
				status: 'declared',
				items: [{ free_text: 'น้ำดื่ม', qty: '25', unit: 'bottle' }] // Maps to item:water
			}
		];

		const reserved = calculateReserved(donations, [], 'camp-any');
		expect(reserved.get('item:rice')).toBe('15');
		expect(reserved.get('item:water')).toBe('25');
	});

	it('returns the reserved quota once a donation is expired past its TTL (T-21)', () => {
		const donation: Donation = {
			...declaredItemsDonation(),
			_id: 'don:ttl',
			campaign_id: 'camp-ttl',
			status: 'declared',
			items: [{ item_id: 'item:rice', qty: '30', unit: 'kg' }]
		};

		// While declared, the quota is held.
		expect(calculateReserved([donation], [], 'camp-ttl').get('item:rice')).toBe('30');

		// After the TTL job flips it to expired, the quota is released.
		const expired = expireDonation(donation);
		expect(calculateReserved([expired], [], 'camp-ttl').get('item:rice')).toBeUndefined();
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

		// Case D: float residue that undershoots target without rounding still cuts off
		let noisySum = 0;
		for (let i = 0; i < 10; i++) noisySum += 0.1; // 0.999…9 in IEEE-754
		expect(noisySum < 1).toBe(true);
		expect(isNeedCutOff(1, noisySum, 0, 'open', 'open')).toBe(true);
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
				items: [{ item_id: 'item:water', qty: '40', unit: 'ขวด' }]
			}
		];

		const availability = deriveNeedAvailability(campaign, donations, stockLedgers);
		expect(availability).toHaveLength(2);

		const waterAvail = availability.find((a) => a.item_id === 'item:water');
		expect(waterAvail).toBeDefined();
		expect(waterAvail?.qty_on_hand).toBe('30');
		expect(waterAvail?.qty_reserved).toBe('40');
		expect(waterAvail?.qty_remaining).toBe('30');
		expect(waterAvail?.is_cut_off).toBe(false);

		const riceAvail = availability.find((a) => a.item_id === 'item:rice');
		expect(riceAvail).toBeDefined();
		expect(riceAvail?.qty_on_hand).toBe('0');
		expect(riceAvail?.qty_reserved).toBe('0');
		expect(riceAvail?.qty_remaining).toBe('50');
		expect(riceAvail?.is_cut_off).toBe(false);
	});
});

describe('createReceiveEntry', () => {
	it('maps sources to correct reasons, each with the ref_id its reason requires', () => {
		// The ref_id column is not decoration: CR-055 R2 pairs each reason with the
		// kind of doc it may point at, and R9 makes this schema reject a mismatch.
		const cases = [
			{ source: 'donation', reason: 'donation', ref_id: DONATION_REF },
			{ source: 'transfer_in', reason: 'transfer_in', ref_id: 'stock_transfer:01JFIXTUREXFER' },
			{ source: 'manual', reason: 'adjust', ref_id: null }
		] as const;

		for (const { source, reason, ref_id } of cases) {
			const entry = createReceiveEntry(
				{
					item_id: 'item:rice',
					qty: 5,
					unit: 'kg',
					source: source as ReceiveSource,
					ref_id
				},
				ctx
			);
			expect(entry.reason).toBe(reason);
			expect(entry.ref_id).toBe(ref_id);
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
					ref_id: DONATION_REF
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
					ref_id: DONATION_REF
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
				ref_id: DONATION_REF,
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
				ref_id: DONATION_REF
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
				ref_id: DONATION_REF
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
		expect(entry.qty).toBe('-5'); // Must be negative
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

		expect(entry.qty).toBe('-10');
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

// CR-052 §1.6 — a manual cut-off stops donors mid-flow while the target is still
// short, so the reason is what the audit trail and the transparency report are built
// from. Enforced in the domain, not the dialog, so no caller can skip it.
describe('forceCutOffNeed + reopenNeed (T-22 manual force cut-off)', () => {
	const campaign = () =>
		createCampaign(
			{
				title: 'ของใช้จำเป็น',
				needs: [
					{ item_id: 'item:water', qty_target: 100, unit: 'ขวด' },
					{ item_id: 'item:rice', qty_target: 50, unit: 'kg' }
				]
			},
			ctx
		);

	it('refuses an empty reason', () => {
		expect(() => forceCutOffNeed(campaign(), 'item:water', '')).toThrow(/reason/i);
	});

	it('refuses a whitespace-only reason', () => {
		expect(() => forceCutOffNeed(campaign(), 'item:water', '     ')).toThrow(/reason/i);
	});

	it('closes only the named need when a reason is given', () => {
		const closed = forceCutOffNeed(campaign(), 'item:water', 'พื้นที่คลังเต็ม');
		expect(closed.needs.find((n) => n.item_id === 'item:water')?.status).toBe('closed');
		expect(closed.needs.find((n) => n.item_id === 'item:rice')?.status).toBe('open');
	});

	it('does not mutate the campaign it was handed', () => {
		const original = campaign();
		forceCutOffNeed(original, 'item:water', 'พื้นที่คลังเต็ม');
		expect(original.needs.find((n) => n.item_id === 'item:water')?.status).toBe('open');
	});

	it('rejects an item the campaign does not ask for', () => {
		expect(() => forceCutOffNeed(campaign(), 'item:soap', 'พื้นที่คลังเต็ม')).toThrow(/item:soap/);
	});

	it('a closed need cuts off regardless of how far the target still is', () => {
		const closed = forceCutOffNeed(campaign(), 'item:water', 'พื้นที่คลังเต็ม');
		const need = closed.needs.find((n) => n.item_id === 'item:water');
		expect(isNeedCutOff(need!.qty_target, '0', '0', need!.status, closed.status)).toBe(true);
	});

	it('reopens without demanding a reason', () => {
		const closed = forceCutOffNeed(campaign(), 'item:water', 'พื้นที่คลังเต็ม');
		const reopened = reopenNeed(closed, 'item:water');
		expect(reopened.needs.find((n) => n.item_id === 'item:water')?.status).toBe('open');
		expect(reopened.needs.find((n) => n.item_id === 'item:rice')?.status).toBe('open');
	});
});

// CR-052 moves a public booking through pending_review → verifying before it becomes
// stock. Every quota/cut-off reader has to treat those as still owed to the shelter,
// or the board reopens a need the donor is already on their way to fill.
describe('donation statuses that still owe the shelter goods (CR-052)', () => {
	it('counts declared, pending_review and verifying as outstanding', () => {
		expect(isDonationOutstanding('declared')).toBe(true);
		expect(isDonationOutstanding('pending_review')).toBe(true);
		expect(isDonationOutstanding('verifying')).toBe(true);
	});

	it('does not count statuses whose goods will never arrive here', () => {
		expect(isDonationOutstanding('received')).toBe(false);
		expect(isDonationOutstanding('redirected')).toBe(false);
		expect(isDonationOutstanding('rejected')).toBe(false);
		expect(isDonationOutstanding('expired')).toBe(false);
		expect(isDonationOutstanding('cancelled')).toBe(false);
	});

	it('reserves quota for a pending_review booking', () => {
		const reserved = calculateReserved(
			[
				{
					...declaredItemsDonation(),
					status: 'pending_review',
					items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }]
				}
			],
			[]
		);
		expect(reserved.get('item:rice')).toBe('10');
	});

	it('releases quota once a booking is redirected or rejected', () => {
		for (const status of ['redirected', 'rejected'] as const) {
			const reserved = calculateReserved(
				[
					{
						...declaredItemsDonation(),
						status,
						items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }]
					}
				],
				[]
			);
			expect(reserved.get('item:rice')).toBeUndefined();
		}
	});

	it('offers a verifying booking to the receive form and drops a redirected one', () => {
		const verifying = {
			...declaredItemsDonation(),
			_id: 'donation:A',
			status: 'verifying' as const
		};
		const redirected = {
			...declaredItemsDonation(),
			_id: 'donation:B',
			status: 'redirected' as const
		};
		expect(keyableDonations([verifying, redirected], []).map((d) => d._id)).toEqual(['donation:A']);
	});

	it('walks the CR-052 review chain forward only', () => {
		expect(canTransitionDonation('declared', 'pending_review')).toBe(true);
		expect(canTransitionDonation('pending_review', 'verifying')).toBe(true);
		expect(canTransitionDonation('verifying', 'received')).toBe(true);
		expect(canTransitionDonation('pending_review', 'redirected')).toBe(true);
		expect(canTransitionDonation('pending_review', 'rejected')).toBe(true);

		// No skipping the review step, and nothing comes back out of a terminal status.
		expect(canTransitionDonation('pending_review', 'received')).toBe(false);
		expect(canTransitionDonation('verifying', 'pending_review')).toBe(false);
		expect(canTransitionDonation('received', 'verifying')).toBe(false);
		expect(canTransitionDonation('rejected', 'pending_review')).toBe(false);
	});
});

// CR-088 — lot_no / storage_zone on `stock_ledger.lot` (schema.md §2.1)
describe('lot numbering (CR-088)', () => {
	const aug25 = new Date(2026, 7, 25); // local time — the label is read on site

	it('stamps YYMMDD in local time, zero-padded', () => {
		expect(lotDateStamp(aug25)).toBe('260825');
		expect(lotDateStamp(new Date(2026, 0, 3))).toBe('260103');
	});

	it('starts a fresh day at 001 and pads the sequence to 3 digits', () => {
		expect(nextLotNos([], aug25, 2)).toEqual(['L-260825-001', 'L-260825-002']);
	});

	it('continues after the highest existing lot of the SAME day only', () => {
		const existing = ['L-260825-001', 'L-260825-007', 'L-260824-099', 'L-260826-050'];
		expect(nextLotNos(existing, aug25, 1)).toEqual(['L-260825-008']);
	});

	it('ignores malformed lot numbers instead of throwing', () => {
		expect(nextLotNos(['L-260825-abc', 'garbage', ''], aug25, 1)).toEqual(['L-260825-001']);
	});

	it('returns nothing when no lines were counted', () => {
		expect(nextLotNos([], aug25, 0)).toEqual([]);
	});

	it('rolls past 999 without truncating (label stays readable, no wrap)', () => {
		expect(nextLotNos(['L-260825-999'], aug25, 1)).toEqual(['L-260825-1000']);
	});

	it('accepts a well-formed lot_no and a storage_zone', () => {
		const parsed = stockLotSchema.parse({
			lot_no: 'L-260825-001',
			storage_zone: '  A-01  ',
			expiry: '2026-12-01'
		});
		expect(parsed.lot_no).toBe('L-260825-001');
		expect(parsed.storage_zone).toBe('A-01');
	});

	it('rejects a lot_no that is not L-YYMMDD-XXX', () => {
		expect(() => stockLotSchema.parse({ lot_no: 'LOT-1' })).toThrow();
		expect(() => stockLotSchema.parse({ lot_no: 'L-260825-1' })).toThrow();
	});

	it('carries the lot through createStockLedger onto the persisted doc', () => {
		const ctx = { shelterCode: 'SH001', createdBy: 'staff01' };
		const entry = createStockLedger(
			{
				item_id: 'item:rice',
				qty: 5,
				unit: 'kg',
				reason: 'donation',
				ref_id: 'donation:123',
				lot: { lot_no: 'L-260825-001', storage_zone: 'A-01' }
			},
			ctx
		);
		expect(entry.lot).toEqual({ lot_no: 'L-260825-001', storage_zone: 'A-01' });
		expect(entry.schema_v).toBe(4);
		expect(parseStockLedger(entry)).toEqual(entry);
	});
});
