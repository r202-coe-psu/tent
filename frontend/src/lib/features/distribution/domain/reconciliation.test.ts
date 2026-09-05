import { describe, expect, it } from 'vitest';
import {
	calculateReconciliation,
	reconciliationInputSchema,
	closeBatchInputSchema
} from './reconciliation';

const base = {
	item_id: 'item:rice',
	lot_ref: 'stock_ledger:LOT-A',
	allocated_qty: '10',
	distributed_qty: '6',
	damaged_qty: '1',
	lost_qty: '1',
	damaged_note: 'ถุงฉีก',
	lost_note: 'สูญหายระหว่างแจก'
};

describe('calculateReconciliation', () => {
	it('calculates an ordinary remainder and preserves audit notes', () => {
		expect(calculateReconciliation(base)).toEqual({ ...base, return_qty: '2' });
	});

	it('accepts an exact zero remainder', () => {
		expect(
			calculateReconciliation({
				...base,
				allocated_qty: '8',
				damaged_qty: '0',
				lost_qty: '2',
				damaged_note: undefined
			}).return_qty
		).toBe('0');
	});

	it('calculates decimal quantities without floating-point drift', () => {
		const result = calculateReconciliation({
			...base,
			allocated_qty: '0.3',
			distributed_qty: '0.1',
			damaged_qty: '0.1',
			lost_qty: '0',
			lost_note: undefined
		});
		expect(result.return_qty).toBe('0.1');
	});

	it('fails closed when distributed exceeds allocated', () => {
		expect(() =>
			calculateReconciliation({
				...base,
				allocated_qty: '5',
				distributed_qty: '6',
				damaged_qty: '0',
				lost_qty: '0',
				damaged_note: undefined,
				lost_note: undefined
			})
		).toThrow(/exceeds allocation/);
	});

	it('fails closed when damaged and lost quantities make the remainder negative', () => {
		expect(() =>
			calculateReconciliation({
				...base,
				allocated_qty: '7',
				distributed_qty: '6',
				damaged_qty: '1',
				lost_qty: '1'
			})
		).toThrow(/exceeds allocation/);
	});

	it('accepts all zero quantities', () => {
		const result = calculateReconciliation({
			...base,
			allocated_qty: '0',
			distributed_qty: '0',
			damaged_qty: '0',
			lost_qty: '0',
			damaged_note: undefined,
			lost_note: undefined
		});
		expect(result.return_qty).toBe('0');
	});

	it('rejects negative inputs', () => {
		expect(reconciliationInputSchema.safeParse({ ...base, distributed_qty: '-1' }).success).toBe(
			false
		);
	});

	it('requires damaged_note when damaged_qty is positive', () => {
		expect(reconciliationInputSchema.safeParse({ ...base, damaged_note: undefined }).success).toBe(
			false
		);
	});

	it('requires lost_note when lost_qty is positive', () => {
		expect(reconciliationInputSchema.safeParse({ ...base, lost_note: undefined }).success).toBe(
			false
		);
	});

	it('accepts damaged quantity with its dedicated note', () => {
		expect(
			reconciliationInputSchema.safeParse({
				...base,
				lost_qty: '0',
				lost_note: undefined
			}).success
		).toBe(true);
	});

	it('accepts lost quantity with its dedicated note', () => {
		expect(
			reconciliationInputSchema.safeParse({
				...base,
				damaged_qty: '0',
				damaged_note: undefined
			}).success
		).toBe(true);
	});

	it('accepts both quantities when both dedicated notes are present', () => {
		expect(reconciliationInputSchema.safeParse(base).success).toBe(true);
	});
});

describe('closeBatchInputSchema', () => {
	it('defaults to empty reconciliation when input is empty or undefined', () => {
		const parsed = closeBatchInputSchema.parse({});
		expect(parsed.reconciliation).toEqual([]);
	});

	it('accepts valid operator-entered facts with required notes', () => {
		const parsed = closeBatchInputSchema.parse({
			reconciliation: [
				{
					item_id: 'item:rice',
					lot_ref: 'stock_ledger:LOT-1',
					damaged_qty: '2',
					damaged_note: 'ถุงฉีกขาด',
					lost_qty: '1',
					lost_note: 'ตกหล่น'
				}
			]
		});
		expect(parsed.reconciliation).toHaveLength(1);
		expect(parsed.reconciliation[0].damaged_qty).toBe('2');
		expect(parsed.reconciliation[0].lost_qty).toBe('1');
	});

	it('defaults damaged_qty and lost_qty to zero when omitted', () => {
		const parsed = closeBatchInputSchema.parse({
			reconciliation: [
				{
					item_id: 'item:rice',
					lot_ref: 'stock_ledger:LOT-1'
				}
			]
		});
		expect(parsed.reconciliation[0].damaged_qty).toBe('0');
		expect(parsed.reconciliation[0].lost_qty).toBe('0');
	});

	it('rejects positive damaged_qty without damaged_note', () => {
		const res = closeBatchInputSchema.safeParse({
			reconciliation: [
				{
					item_id: 'item:rice',
					lot_ref: 'stock_ledger:LOT-1',
					damaged_qty: '1'
				}
			]
		});
		expect(res.success).toBe(false);
	});

	it('rejects positive lost_qty without lost_note', () => {
		const res = closeBatchInputSchema.safeParse({
			reconciliation: [
				{
					item_id: 'item:rice',
					lot_ref: 'stock_ledger:LOT-1',
					lost_qty: '1'
				}
			]
		});
		expect(res.success).toBe(false);
	});

	it('rejects negative quantities', () => {
		const res = closeBatchInputSchema.safeParse({
			reconciliation: [
				{
					item_id: 'item:rice',
					lot_ref: 'stock_ledger:LOT-1',
					damaged_qty: '-1'
				}
			]
		});
		expect(res.success).toBe(false);
	});
});
