import { describe, expect, it } from 'vitest';
import { dropIndex, moveItem, sameOrder } from './kiosk-banner-order';

describe('moveItem', () => {
	it('moves an item up so it ends at the target index', () => {
		expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
	});

	it('moves an item down so it ends at the target index', () => {
		expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
	});

	it('returns an unchanged copy when from equals to or an index is out of range', () => {
		const list = ['a', 'b', 'c'];
		for (const [from, to] of [
			[1, 1],
			[-1, 0],
			[3, 0],
			[0, -1],
			[0, 3]
		]) {
			const result = moveItem(list, from, to);
			expect(result).toEqual(['a', 'b', 'c']);
			expect(result).not.toBe(list);
		}
	});

	it('does not mutate the input', () => {
		const list = ['a', 'b', 'c'];
		moveItem(list, 2, 0);
		expect(list).toEqual(['a', 'b', 'c']);
	});
});

describe('dropIndex', () => {
	it('counts the row midpoints above the pointer', () => {
		expect(dropIndex([10, 30, 50], 5)).toBe(0);
		expect(dropIndex([10, 30, 50], 20)).toBe(1);
		expect(dropIndex([10, 30, 50], 60)).toBe(3);
	});

	it('does not count a midpoint exactly at the pointer', () => {
		expect(dropIndex([10, 30, 50], 30)).toBe(1);
	});

	it('is 0 when there are no other rows', () => {
		expect(dropIndex([], 100)).toBe(0);
	});
});

describe('sameOrder', () => {
	const row = (_id: string) => ({ _id });

	it('is true when both lists hold the same ids in the same sequence', () => {
		expect(sameOrder([row('a'), row('b')], [row('a'), row('b')])).toBe(true);
		expect(sameOrder([], [])).toBe(true);
	});

	it('is false when the sequence differs', () => {
		expect(sameOrder([row('a'), row('b')], [row('b'), row('a')])).toBe(false);
	});

	it('is false when the lengths differ', () => {
		expect(sameOrder([row('a')], [row('a'), row('b')])).toBe(false);
	});
});
