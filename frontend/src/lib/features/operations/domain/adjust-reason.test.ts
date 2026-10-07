import { describe, it, expect } from 'vitest';
import {
	adjustInputSchema,
	adjustReasonSchema,
	calculateReserved,
	createAdjustEntry,
	createLegacyFlow2StockLedger,
	createReceiveEntry,
	createStockLedger,
	MANUAL_ADJUST_REASONS,
	parseStockLedger,
	projectStockLotBalances,
	resolveAdjustReason,
	stockBalance,
	stockLedgerInputSchema,
	type LedgerReason,
	type StockLedger
} from './operations';
import type { AuthorContext } from '$lib/db/model';
import { addQty } from '$lib/utils/qty';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff1' };

// CR-143 §C — `adjust_reason` + `note` on stock_ledger (schema_v 5 -> 6).
const adjust = { item_id: 'item:rice', qty: '-2', unit: 'kg', ref_id: null } as const;

describe('AC-C1 — adjusting without a reason is a validation error', () => {
	it('rejects adjustInputSchema without adjust_reason', () => {
		const result = adjustInputSchema.safeParse(adjust);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path[0] === 'adjust_reason')).toBe(true);
		}
	});

	it('rejects createAdjustEntry without adjust_reason', () => {
		expect(() => createAdjustEntry(adjust as never, ctx)).toThrow();
	});

	it('rejects createStockLedger reason=adjust without adjust_reason (FR-C2)', () => {
		expect(() => createStockLedger({ ...adjust, reason: 'adjust' }, ctx)).toThrow();
	});

	it('rejects an adjust_reason outside the enum', () => {
		expect(() => createAdjustEntry({ ...adjust, adjust_reason: 'stolen' } as never, ctx)).toThrow();
	});

	it.each(['expired', 'damaged', 'count_mismatch', 'lost', 'found', 'other'] as const)(
		'accepts %s and persists it (FR-C1)',
		(adjust_reason) => {
			const note = adjust_reason === 'other' ? { note: 'รายละเอียด' } : {};
			const entry = createAdjustEntry({ ...adjust, adjust_reason, ...note }, ctx);
			expect(entry.adjust_reason).toBe(adjust_reason);
			expect(entry.reason).toBe('adjust');
		}
	);
});

describe('FR-C6 — merge is reserved for the merge flow', () => {
	it('the generic adjust input rejects merge', () => {
		expect(adjustInputSchema.safeParse({ ...adjust, adjust_reason: 'merge' }).success).toBe(false);
		expect(() => createAdjustEntry({ ...adjust, adjust_reason: 'merge' } as never, ctx)).toThrow();
	});

	it('manual reasons list excludes merge but the persisted enum keeps it', () => {
		expect(MANUAL_ADJUST_REASONS).not.toContain('merge');
		expect(MANUAL_ADJUST_REASONS).toHaveLength(adjustReasonSchema.options.length - 1);
		expect(adjustReasonSchema.options).toContain('merge');
	});

	it('the ledger factory still accepts merge for the §F flow', () => {
		const entry = createStockLedger(
			{ ...adjust, reason: 'adjust', adjust_reason: 'merge', note: 'item_master:other' },
			ctx
		);
		expect(entry.adjust_reason).toBe('merge');
		expect(entry.note).toBe('item_master:other');
	});
});

describe('AC-C2 — adjust_reason / note belong to adjust rows only', () => {
	const rows: { reason: LedgerReason; ref_id: string | null; qty: string; lot_ref?: string }[] = [
		{ reason: 'receive', ref_id: 'distribution_log:01J', qty: '5' },
		{ reason: 'donation', ref_id: 'donation:01J', qty: '5' },
		{ reason: 'requisition', ref_id: 'requisition_ticket:01J', qty: '-5' },
		{ reason: 'transfer_in', ref_id: 'stock_transfer:01J', qty: '5' },
		{ reason: 'transfer_out', ref_id: 'stock_transfer:01J', qty: '-5' },
		{
			reason: 'distribute',
			ref_id: 'requisition_ticket:01J',
			qty: '-5',
			lot_ref: 'stock_ledger:01J'
		},
		{
			reason: 'distribution_return',
			ref_id: 'distribution_batch:01J',
			qty: '5',
			lot_ref: 'stock_ledger:01J'
		}
	];

	it.each(rows)('rejects adjust_reason on reason=$reason', (row) => {
		const input = { item_id: 'item:rice', unit: 'kg', ...row };
		expect(stockLedgerInputSchema.safeParse(input).success).toBe(true);
		expect(stockLedgerInputSchema.safeParse({ ...input, adjust_reason: 'lost' }).success).toBe(
			false
		);
		expect(() => createStockLedger({ ...input, adjust_reason: 'lost' }, ctx)).toThrow();
	});

	it.each(rows)('rejects note on reason=$reason', (row) => {
		const input = { item_id: 'item:rice', unit: 'kg', ...row };
		expect(stockLedgerInputSchema.safeParse({ ...input, note: 'x' }).success).toBe(false);
	});

	it('rejects the legacy Flow 2 writer too', () => {
		expect(() =>
			createLegacyFlow2StockLedger(
				{
					item_id: 'item:rice',
					qty: '-1',
					unit: 'kg',
					reason: 'distribute',
					ref_id: 'distribution_batch:01J',
					lot_ref: 'stock_ledger:01J',
					adjust_reason: 'lost'
				},
				ctx
			)
		).toThrow();
	});
});

describe('note (FR-C1)', () => {
	it('is optional, trimmed, and omitted when blank', () => {
		const withNote = createAdjustEntry(
			{ ...adjust, adjust_reason: 'damaged', note: '  กระสอบฉีก  ' },
			ctx
		);
		expect(withNote.note).toBe('กระสอบฉีก');
		const blank = createAdjustEntry({ ...adjust, adjust_reason: 'damaged', note: '   ' }, ctx);
		expect('note' in blank).toBe(false);
		const none = createAdjustEntry({ ...adjust, adjust_reason: 'damaged' }, ctx);
		expect('note' in none).toBe(false);
	});

	it('caps at 500 characters', () => {
		expect(
			adjustInputSchema.safeParse({ ...adjust, adjust_reason: 'other', note: 'ก'.repeat(500) })
				.success
		).toBe(true);
		expect(
			adjustInputSchema.safeParse({ ...adjust, adjust_reason: 'other', note: 'ก'.repeat(501) })
				.success
		).toBe(false);
	});

	it('is not lot.note', () => {
		const entry = createAdjustEntry(
			{
				...adjust,
				adjust_reason: 'lost',
				note: 'หาย',
				lot: { expiry: '2027-01-01T00:00:00.000Z' }
			},
			ctx
		);
		expect(entry.lot?.note).toBeUndefined();
	});
});

describe('FR-C2 — every writer stamps schema_v 6', () => {
	it('createStockLedger, createAdjustEntry and the legacy Flow 2 writer', () => {
		const adjusted = createAdjustEntry({ ...adjust, adjust_reason: 'lost' }, ctx);
		const received = createStockLedger(
			{
				item_id: 'item:rice',
				qty: '5',
				unit: 'kg',
				reason: 'receive',
				ref_id: 'distribution_log:01J'
			},
			ctx
		);
		const legacy = createLegacyFlow2StockLedger(
			{ item_id: 'item:rice', qty: '5', unit: 'kg', reason: 'receive', ref_id: null },
			ctx
		);
		expect([adjusted.schema_v, received.schema_v, legacy.schema_v]).toEqual([6, 6, 6]);
	});

	it('a manual receive (source=manual) is an adjust with reason found (FR-C7 / AC-C5)', () => {
		const entry = createReceiveEntry(
			{ item_id: 'item:rice', qty: 5, unit: 'kg', source: 'manual', ref_id: null },
			ctx
		);
		expect(entry.reason).toBe('adjust');
		expect(entry.adjust_reason).toBe('found');
		expect('note' in entry).toBe(false);
	});
});

describe("FR-C9 / AC-C6 — adjust_reason 'other' needs a non-empty note", () => {
	const other = { ...adjust, adjust_reason: 'other' } as const;

	it.each([undefined, '', '   '])('rejects adjustInputSchema with note %j', (note) => {
		const result = adjustInputSchema.safeParse({ ...other, note });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path[0] === 'note')).toBe(true);
		}
		expect(() => createAdjustEntry({ ...other, note }, ctx)).toThrow();
	});

	it('rejects stockLedgerInputSchema / createStockLedger reason=adjust other without note', () => {
		expect(stockLedgerInputSchema.safeParse({ ...other, reason: 'adjust' }).success).toBe(false);
		expect(() => createStockLedger({ ...other, reason: 'adjust', note: ' ' }, ctx)).toThrow();
	});

	it('accepts other with a trimmed note and keeps it', () => {
		const entry = createAdjustEntry({ ...other, note: '  กระสอบฉีก  ' }, ctx);
		expect(entry.note).toBe('กระสอบฉีก');
		expect(
			stockLedgerInputSchema.safeParse({ ...other, reason: 'adjust', note: 'x' }).success
		).toBe(true);
	});

	it('does not require a note for the other reasons', () => {
		expect(adjustInputSchema.safeParse({ ...adjust, adjust_reason: 'lost' }).success).toBe(true);
	});
});

describe('FR-C10 / AC-C7 — an old other row without a note still reads', () => {
	it('parses it and counts it in the balance', () => {
		const entry = createAdjustEntry({ ...adjust, qty: '-3', adjust_reason: 'lost' }, ctx);
		const old = { ...entry, schema_v: 6, adjust_reason: 'other' } as unknown as StockLedger;
		expect('note' in old).toBe(false);
		expect(parseStockLedger(old).adjust_reason).toBe('other');
		expect(resolveAdjustReason(old)).toBe('other');
		expect(stockBalance([old]).get('item:rice')).toBe('-3');
	});
});

describe('FR-C4 / AC-C3 — readers accept schema_v <= 5 rows', () => {
	/** A row as a schema_v 5 writer persisted it: an adjust with no adjust_reason. */
	const legacyAdjust = (over: Partial<StockLedger> = {}): StockLedger => {
		const entry = createAdjustEntry({ ...adjust, qty: '-3', adjust_reason: 'lost' }, ctx);
		const legacy: Record<string, unknown> = { ...entry, schema_v: 5, ...over };
		delete legacy.adjust_reason;
		return legacy as unknown as StockLedger;
	};

	it('maps a missing adjust_reason on an adjust row to other', () => {
		expect(resolveAdjustReason(legacyAdjust())).toBe('other');
	});

	it('keeps the stored reason on new rows and returns null for other reasons', () => {
		const entry = createAdjustEntry({ ...adjust, adjust_reason: 'expired' }, ctx);
		expect(resolveAdjustReason(entry)).toBe('expired');
		const received = createStockLedger(
			{
				item_id: 'item:rice',
				qty: '5',
				unit: 'kg',
				reason: 'receive',
				ref_id: 'distribution_log:01J'
			},
			ctx
		);
		expect(resolveAdjustReason(received)).toBeNull();
	});

	it('parses schema_v 5 and 6 rows without throwing', () => {
		expect(parseStockLedger(legacyAdjust()).schema_v).toBe(5);
		const modern = createAdjustEntry({ ...adjust, adjust_reason: 'lost' }, ctx);
		expect(parseStockLedger(modern).schema_v).toBe(6);
		expect(parseStockLedger(modern).adjust_reason).toBe('lost');
	});

	it('computes balances, lots and reservations over a mixed schema_v 5/6 ledger', () => {
		const received = createStockLedger(
			{
				item_id: 'item:rice',
				qty: '20',
				unit: 'kg',
				reason: 'receive',
				ref_id: 'distribution_log:01J',
				occurred_at: '2026-10-01T08:00:00.000Z'
			},
			ctx
		);
		const v5received = {
			...received,
			_id: 'stock_ledger:01JLEGACYV5',
			lot_ref: 'stock_ledger:01JLEGACYV5',
			schema_v: 5,
			occurred_at: '2026-09-30T08:00:00.000Z'
		} as unknown as StockLedger;
		const v5adjust = legacyAdjust({ occurred_at: '2026-10-02T08:00:00.000Z' });
		const v6adjust = createAdjustEntry(
			{
				...adjust,
				qty: '-2',
				adjust_reason: 'damaged',
				occurred_at: '2026-10-03T08:00:00.000Z'
			},
			ctx
		);
		const mixed = [received, v5received, v5adjust, v6adjust];

		expect(stockBalance(mixed).get('item:rice')).toBe('35'); // 20 + 20 - 3 - 2
		expect(() => mixed.forEach((e) => parseStockLedger(e))).not.toThrow();
		expect(() => calculateReserved([], mixed)).not.toThrow();
		const lots = projectStockLotBalances(mixed);
		expect(lots.reduce((sum, lot) => addQty(sum, lot.qty), '0')).toBe('35');
	});
});
