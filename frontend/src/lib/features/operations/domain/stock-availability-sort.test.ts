import { describe, expect, it } from 'vitest';
import {
	isOutOfStock,
	partitionInStockFirst,
	sortInStockFirstByName
} from './stock-availability-sort';

type Row = { id: string; name: string };

const row = (id: string, name: string): Row => ({ id, name });
const balances = (m: Record<string, string>) => (r: Row) => m[r.id];
const nameOf = (r: Row) => r.name;

describe('isOutOfStock', () => {
	it('treats missing, zero and negative balances as out of stock', () => {
		expect(isOutOfStock(undefined)).toBe(true);
		expect(isOutOfStock('0')).toBe(true);
		expect(isOutOfStock('0.00')).toBe(true);
		expect(isOutOfStock('-3')).toBe(true);
	});

	it('treats positive balances (incl. decimals) as in stock', () => {
		expect(isOutOfStock('1')).toBe(false);
		expect(isOutOfStock('0.5')).toBe(false);
	});
});

describe('sortInStockFirstByName', () => {
	it('puts in-stock before out-of-stock and sorts names within each group', () => {
		const items = [row('a', 'B'), row('b', 'A'), row('c', 'D'), row('d', 'C')];
		const get = balances({ a: '0', b: '5', c: '2', d: '-1' });
		expect(sortInStockFirstByName(items, get, nameOf).map((r) => r.id)).toEqual([
			'b',
			'c',
			'a',
			'd'
		]);
	});

	it('orders Thai names by Thai collation', () => {
		const items = [row('1', 'ผ้าห่ม'), row('2', 'ข้าวสาร'), row('3', 'น้ำดื่ม')];
		const get = balances({ '1': '1', '2': '1', '3': '1' });
		expect(sortInStockFirstByName(items, get, nameOf).map((r) => r.name)).toEqual([
			'ข้าวสาร',
			'น้ำดื่ม',
			'ผ้าห่ม'
		]);
	});

	it('treats a missing balance as out of stock', () => {
		const items = [row('a', 'A'), row('b', 'B')];
		const get = balances({ b: '0.25' });
		expect(sortInStockFirstByName(items, get, nameOf).map((r) => r.id)).toEqual(['b', 'a']);
	});

	it('keeps original order on equal names and does not mutate the input', () => {
		const items = [row('x', 'Same'), row('y', 'Same')];
		const copy = [...items];
		const result = sortInStockFirstByName(items, () => '1', nameOf);
		expect(result.map((r) => r.id)).toEqual(['x', 'y']);
		expect(result).not.toBe(items);
		expect(items).toEqual(copy);
	});
});

describe('partitionInStockFirst', () => {
	it('is a stable partition preserving input order in each group', () => {
		const items = [row('a', 'z'), row('b', 'y'), row('c', 'x'), row('d', 'w'), row('e', 'v')];
		const get = balances({ a: '0', b: '3', c: '0', d: '1', e: '2' });
		const input = [...items];
		expect(partitionInStockFirst(items, get).map((r) => r.id)).toEqual(['b', 'd', 'e', 'a', 'c']);
		expect(items).toEqual(input);
	});
});
