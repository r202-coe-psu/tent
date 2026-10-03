import { describe, expect, it } from 'vitest';
import {
	barcodeOwner,
	findItemByBarcode,
	isBaseUnitRow,
	itemBarcodes,
	looksLikeBarcode,
	mergeBaseBarcode,
	normalizeBarcode,
	splitBaseBarcode
} from './item-barcode';

const milk = {
	_id: 'item_master:milk',
	conversions: [
		{ uom_name: 'pack', barcode: '8850000000012' },
		{ uom_name: 'box', barcode: '8850000000999' }
	]
};
const water = { _id: 'item_master:water', conversions: [{ uom_name: 'bottle', barcode: 'ABC-1' }] };
const plain = { _id: 'item_master:plain' };

describe('normalizeBarcode / looksLikeBarcode', () => {
	it('trims and lowercases', () => {
		expect(normalizeBarcode('  ABC-1\n')).toBe('abc-1');
		expect(normalizeBarcode(undefined)).toBe('');
	});

	it('recognises 8–14 digit retail codes only', () => {
		expect(looksLikeBarcode('8850000000012')).toBe(true);
		expect(looksLikeBarcode(' 12345678 ')).toBe(true);
		expect(looksLikeBarcode('1234567')).toBe(false);
		expect(looksLikeBarcode('123456789012345')).toBe(false);
		expect(looksLikeBarcode('นมถั่วเหลือง')).toBe(false);
		expect(looksLikeBarcode('88500000000a2')).toBe(false);
	});
});

describe('findItemByBarcode', () => {
	const items = [plain, milk, water];

	it('returns the item and the unit the code identifies', () => {
		expect(findItemByBarcode(items, '8850000000999')).toEqual({ item: milk, uom: 'box' });
	});

	it('matches ignoring case and surrounding whitespace', () => {
		expect(findItemByBarcode(items, ' abc-1 ')?.item).toBe(water);
	});

	it('returns null for unknown or empty codes', () => {
		expect(findItemByBarcode(items, '0000')).toBeNull();
		expect(findItemByBarcode(items, '   ')).toBeNull();
		expect(findItemByBarcode([plain], 'x')).toBeNull();
	});
});

describe('barcodeOwner', () => {
	it('finds another item using the code', () => {
		expect(barcodeOwner([milk, water], 'abc-1', milk._id)).toBe(water);
	});

	it('ignores the item being edited', () => {
		expect(barcodeOwner([milk, water], '8850000000012', milk._id)).toBeNull();
	});
});

describe('itemBarcodes', () => {
	it('lists non-empty barcodes in row order', () => {
		expect(itemBarcodes(milk)).toEqual(['8850000000012', '8850000000999']);
		expect(itemBarcodes({ conversions: [{ uom_name: 'a', barcode: ' ' }] })).toEqual([]);
		expect(itemBarcodes({})).toEqual([]);
	});
});

describe('base-unit barcode row', () => {
	const rows = [
		{ uom_name: 'pack', multiplier: '12', barcode: '111' },
		{ uom_name: 'box', multiplier: '1', barcode: '222' }
	];

	it('detects the base-unit row case-insensitively', () => {
		expect(isBaseUnitRow({ uom_name: 'Box' }, 'box')).toBe(true);
		expect(isBaseUnitRow({ uom_name: 'pack' }, 'box')).toBe(false);
		expect(isBaseUnitRow({ uom_name: '' }, '')).toBe(false);
	});

	it('splits the base row from pack rows', () => {
		const { packRows, baseBarcode } = splitBaseBarcode(rows, 'box');
		expect(baseBarcode).toBe('222');
		expect(packRows).toEqual([rows[0]]);
	});

	it('leaves docs without a base row untouched', () => {
		const { packRows, baseBarcode } = splitBaseBarcode([rows[0]], 'box');
		expect(packRows).toEqual([rows[0]]);
		expect(baseBarcode).toBe('');
		expect(mergeBaseBarcode(packRows, 'box', '')).toEqual([rows[0]]);
	});

	it('round-trips split → merge', () => {
		const { packRows, baseBarcode } = splitBaseBarcode(rows, 'box');
		expect(mergeBaseBarcode(packRows, 'box', baseBarcode)).toEqual([
			rows[0],
			{ uom_name: 'box', multiplier: '1', barcode: '222' }
		]);
	});

	it('does not add a row without a base unit', () => {
		expect(mergeBaseBarcode([], '', '999')).toEqual([]);
	});
});
