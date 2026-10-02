import { describe, expect, it } from 'vitest';
import { clampPage, paginateItems } from './paginate';

describe('paginateItems', () => {
	const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

	it('returns the first page slice', () => {
		expect(paginateItems(items, 1, 5)).toEqual({
			items: [1, 2, 3, 4, 5],
			total: 12,
			page: 1,
			pageSize: 5,
			totalPages: 3
		});
	});

	it('returns a middle page slice', () => {
		expect(paginateItems(items, 2, 5)).toEqual({
			items: [6, 7, 8, 9, 10],
			total: 12,
			page: 2,
			pageSize: 5,
			totalPages: 3
		});
	});

	it('returns a partial last page', () => {
		expect(paginateItems(items, 3, 5)).toEqual({
			items: [11, 12],
			total: 12,
			page: 3,
			pageSize: 5,
			totalPages: 3
		});
	});

	it('clamps page below 1 to page 1', () => {
		expect(paginateItems(items, 0, 5).page).toBe(1);
		expect(paginateItems(items, -3, 5).items).toEqual([1, 2, 3, 4, 5]);
	});

	it('clamps page above totalPages to the last page', () => {
		expect(paginateItems(items, 99, 5)).toEqual({
			items: [11, 12],
			total: 12,
			page: 3,
			pageSize: 5,
			totalPages: 3
		});
	});

	it('handles an empty list with totalPages of 1', () => {
		expect(paginateItems([], 1, 10)).toEqual({
			items: [],
			total: 0,
			page: 1,
			pageSize: 10,
			totalPages: 1
		});
	});

	it('handles a single full page', () => {
		expect(paginateItems([1, 2, 3], 1, 10)).toEqual({
			items: [1, 2, 3],
			total: 3,
			page: 1,
			pageSize: 10,
			totalPages: 1
		});
	});
});

describe('clampPage', () => {
	it('clamps into [1, totalPages]', () => {
		expect(clampPage(0, 5)).toBe(1);
		expect(clampPage(1, 5)).toBe(1);
		expect(clampPage(3, 5)).toBe(3);
		expect(clampPage(5, 5)).toBe(5);
		expect(clampPage(9, 5)).toBe(5);
	});

	it('treats totalPages below 1 as 1', () => {
		expect(clampPage(2, 0)).toBe(1);
		expect(clampPage(2, -1)).toBe(1);
	});
});
