import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { fractionWriteOffInput, fractionWriteOffQty } from './fraction-write-off';
import {
	assertLotWriteOffsFit,
	createAdjustEntry,
	createStockLedger,
	projectLotsByItem
} from './operations';

describe('fractionWriteOffQty (#805)', () => {
	it.each([
		['3.5', '-0.5'],
		['0.25', '-0.25'],
		['12.0001', '-0.0001'],
		['7.75', '-0.75']
	])('clears the fraction of %s in a count unit', (balance, expected) => {
		expect(fractionWriteOffQty(balance, 'count')).toBe(expected);
	});

	it.each(['3', '3.0', '0', '-0.5', '-3.5'])('offers nothing for balance %s', (balance) => {
		expect(fractionWriteOffQty(balance, 'count')).toBeUndefined();
	});

	it.each(['mass', 'volume', 'other', undefined] as const)(
		'offers nothing when the dimension is %s',
		(dimension) => {
			expect(fractionWriteOffQty('3.5', dimension)).toBeUndefined();
		}
	);
});

describe('fractionWriteOffInput (#805)', () => {
	const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff1' };
	const inbound = createStockLedger(
		{
			item_id: 'item_master:water',
			qty: '3.5',
			unit: 'ขวด',
			reason: 'donation',
			ref_id: 'donation:d1',
			lot: { storage_zone: 'A', storage_point_id: 'sp1', expiry: '2027-01-31' }
		},
		ctx
	);
	const [lot] = projectLotsByItem([inbound]).lots;

	it('writes the fraction off the same lot, as a counted mismatch with the fixed note', () => {
		const input = fractionWriteOffInput(lot, 'count');

		expect(input).toMatchObject({
			item_id: 'item_master:water',
			qty: '-0.5',
			unit: 'ขวด',
			adjust_reason: 'count_mismatch',
			note: 'ตัดเศษเหลือทิ้ง',
			lot_ref: inbound._id,
			lot: { storage_point_id: 'sp1', storage_zone: 'A', expiry: '2027-01-31' }
		});
		expect(() => assertLotWriteOffsFit([inbound], [input!])).not.toThrow();
	});

	it('is accepted as an adjust and leaves the lot whole', () => {
		const entry = createAdjustEntry(fractionWriteOffInput(lot, 'count')!, ctx);
		const [after] = projectLotsByItem([inbound, entry]).lots;

		expect(after.qty).toBe('3');
	});

	it('is undefined when there is no fraction to clear', () => {
		expect(fractionWriteOffInput({ ...lot, qty: '3' }, 'count')).toBeUndefined();
		expect(fractionWriteOffInput(lot, 'mass')).toBeUndefined();
	});
});
