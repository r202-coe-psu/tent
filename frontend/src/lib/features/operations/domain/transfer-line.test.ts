import { describe, expect, it } from 'vitest';
import { toTransferLine } from './transfer-line';

const rice = {
	base_unit: 'kg',
	conversions: [
		{ uom_name: 'bag', multiplier: '5' },
		{ uom_name: 'sack', multiplier: '50' }
	]
};

describe('toTransferLine', () => {
	it('converts a packaging unit to the base unit the server expects', () => {
		expect(toTransferLine(rice, { item_id: 'item:rice', qty: '2', unit: 'bag' })).toEqual({
			item_id: 'item:rice',
			qty: '10',
			unit: 'kg'
		});
		expect(toTransferLine(rice, { item_id: 'item:rice', qty: '1.5', unit: 'sack' })).toEqual({
			item_id: 'item:rice',
			qty: '75',
			unit: 'kg'
		});
	});

	it('passes a base-unit line through unchanged', () => {
		expect(toTransferLine(rice, { item_id: 'item:rice', qty: '7', unit: 'kg' })).toEqual({
			item_id: 'item:rice',
			qty: '7',
			unit: 'kg'
		});
	});

	it('rejects a unit the item does not know', () => {
		expect(() => toTransferLine(rice, { item_id: 'item:rice', qty: '1', unit: 'crate' })).toThrow(
			/Unknown unit/
		);
	});
});
