import { describe, it, expect } from 'vitest';
import {
	KITCHEN_YIELD_SHELF_LIFE_HOURS,
	kitchenYieldExpiry,
	mergeYieldLines,
	yieldLineKey,
	yieldReceiptInputSchema,
	toYieldReceiptInput,
	yieldTotal,
	type YieldReceiptLine
} from './kitchen-yield-receipt';

const line = (
	item_id: string,
	qty: string,
	storage_point?: { id: string; name: string }
): YieldReceiptLine => ({ item_id, qty, storage_point });

describe('yieldReceiptInputSchema', () => {
	it('accepts a single valid line and normalises the qty', () => {
		const parsed = yieldReceiptInputSchema.parse({
			lines: [{ item_id: 'item_master:A', qty: '80.50' }]
		});
		expect(parsed.lines[0].qty).toBe('80.5');
	});

	it('rejects an empty line list', () => {
		expect(yieldReceiptInputSchema.safeParse({ lines: [] }).success).toBe(false);
	});

	it('rejects a line without an item', () => {
		expect(yieldReceiptInputSchema.safeParse({ lines: [{ item_id: '', qty: '5' }] }).success).toBe(
			false
		);
	});

	it.each(['0', '-3', 'abc'])('rejects qty %s', (qty) => {
		expect(
			yieldReceiptInputSchema.safeParse({ lines: [{ item_id: 'item_master:A', qty }] }).success
		).toBe(false);
	});
});

describe('mergeYieldLines', () => {
	it('sums lines for the same item at the same storage point', () => {
		const merged = mergeYieldLines([line('item_master:A', '30'), line('item_master:A', '20')]);
		expect(merged).toEqual([line('item_master:A', '50')]);
	});

	it('keeps the same item at different storage points separate', () => {
		const merged = mergeYieldLines([
			line('item_master:A', '30', { id: 'p1', name: 'ตู้เย็น 1' }),
			line('item_master:A', '20', { id: 'p2', name: 'ตู้เย็น 2' })
		]);
		expect(merged).toHaveLength(2);
	});

	it('keeps different items separate and preserves order', () => {
		const merged = mergeYieldLines([line('item_master:B', '1'), line('item_master:A', '2')]);
		expect(merged.map((l) => l.item_id)).toEqual(['item_master:B', 'item_master:A']);
	});
});

describe('yieldLineKey', () => {
	it('treats a missing storage point as the empty key', () => {
		expect(yieldLineKey(line('item_master:A', '1'))).toBe('item_master:A|');
		expect(yieldLineKey(line('item_master:A', '1', { id: 'p1', name: 'x' }))).toBe(
			'item_master:A|p1'
		);
	});
});

describe('yieldTotal', () => {
	it('sums quantities without float drift', () => {
		expect(yieldTotal([line('a', '0.1'), line('b', '0.2')])).toBe('0.3');
	});

	it('is zero for no lines', () => {
		expect(yieldTotal([])).toBe('0');
	});
});

describe('kitchenYieldExpiry', () => {
	it('is created_at plus the ready-meal shelf life', () => {
		const expiry = kitchenYieldExpiry({ created_at: '2026-10-02T08:00:00.000Z' });
		expect(KITCHEN_YIELD_SHELF_LIFE_HOURS).toBe(4);
		expect(expiry).toBe('2026-10-02T12:00:00.000Z');
	});
});

describe('toYieldReceiptInput', () => {
	const points = [{ id: 'p1', name: 'ตู้เย็น 1' }];

	it('resolves a storage point id to its id and name', () => {
		const input = toYieldReceiptInput(
			[{ key: 'k1', item_id: 'item_master:A', qty: '5', storage_point_id: 'p1' }],
			points
		);
		expect(input.lines[0].storage_point).toEqual({ id: 'p1', name: 'ตู้เย็น 1' });
	});

	it('maps an empty or unknown point to null (unspecified)', () => {
		const input = toYieldReceiptInput(
			[
				{ key: 'k1', item_id: 'item_master:A', qty: '5', storage_point_id: '' },
				{ key: 'k2', item_id: 'item_master:B', qty: '5', storage_point_id: 'gone' }
			],
			points
		);
		expect(input.lines.map((l) => l.storage_point)).toEqual([null, null]);
	});
});
