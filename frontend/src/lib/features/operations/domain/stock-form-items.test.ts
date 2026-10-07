import { describe, expect, it } from 'vitest';
import { filterStockFormItems, toStockFormItems } from './stock-form-items';

describe('toStockFormItems', () => {
	it('maps supply items with empty conversions and base_unit equal to unit', () => {
		const items = toStockFormItems(
			[{ _id: 'item:rice', name: 'Rice', unit: 'kg', perishable: true }],
			[]
		);
		expect(items).toEqual([
			{
				_id: 'item:rice',
				name: 'Rice',
				unit: 'kg',
				base_unit: 'kg',
				conversions: [],
				requiresExpiry: true
			}
		]);
	});

	it('maps active item masters with packaging fields and sku', () => {
		const items = toStockFormItems(
			[],
			[
				{
					_id: 'item_master:water',
					name: 'Water',
					base_unit: 'bottle',
					sku: 'WAT-01',
					conversions: [{ uom_name: 'pack', multiplier: '6' }],
					default_inventory_uom: 'pack',
					default_issue_uom: 'bottle'
				}
			]
		);
		expect(items).toEqual([
			{
				_id: 'item_master:water',
				name: 'Water',
				unit: 'bottle',
				base_unit: 'bottle',
				conversions: [{ uom_name: 'pack', multiplier: '6' }],
				default_inventory_uom: 'pack',
				default_issue_uom: 'bottle',
				requiresExpiry: false,
				sku: 'WAT-01'
			}
		]);
	});

	// CR-143 §D: item_master has no `perishable` field; the picker used to hardcode false.
	it('derives requiresExpiry for item masters from storage and shelf life (FR-D1)', () => {
		const items = toStockFormItems(
			[],
			[
				{ _id: 'item_master:milk', name: 'Milk', base_unit: 'l', storage_type: 'CHILLED' },
				{ _id: 'item_master:rice', name: 'Rice', base_unit: 'kg', storage_type: 'DRY' },
				{ _id: 'item_master:can', name: 'Can', base_unit: 'can', shelf_life_days: 180 }
			]
		);
		expect(items.map((i) => [i._id, i.requiresExpiry])).toEqual([
			['item_master:milk', true],
			['item_master:rice', false],
			['item_master:can', true]
		]);
		expect(items.find((i) => i._id === 'item_master:can')?.shelf_life_days).toBe(180);
		expect(items.find((i) => i._id === 'item_master:milk')?.storage_type).toBe('CHILLED');
	});

	it('drops deactivated item masters', () => {
		const items = toStockFormItems(
			[],
			[
				{
					_id: 'item_master:old',
					name: 'Old',
					base_unit: 'piece',
					conversions: [],
					deactivated: true
				},
				{
					_id: 'item_master:live',
					name: 'Live',
					base_unit: 'piece',
					conversions: []
				}
			]
		);
		expect(items.map((i) => i._id)).toEqual(['item_master:live']);
	});

	it('merges supply items then item masters', () => {
		const items = toStockFormItems(
			[{ _id: 'item:a', name: 'A', unit: 'kg', perishable: false }],
			[{ _id: 'item_master:b', name: 'B', base_unit: 'piece', conversions: [] }]
		);
		expect(items.map((i) => i._id)).toEqual(['item:a', 'item_master:b']);
	});
});

describe('filterStockFormItems', () => {
	const items = toStockFormItems(
		[{ _id: 'item:rice', name: 'ข้าวสาร', unit: 'kg', perishable: false }],
		[
			{
				_id: 'item_master:water',
				name: 'น้ำดื่ม',
				base_unit: 'bottle',
				sku: 'WAT-01',
				conversions: []
			}
		]
	);

	it('returns all items when query is empty', () => {
		expect(filterStockFormItems(items, '')).toEqual(items);
		expect(filterStockFormItems(items, '   ')).toEqual(items);
	});

	it('matches by name case-insensitively', () => {
		expect(filterStockFormItems(items, 'ข้าว').map((i) => i._id)).toEqual(['item:rice']);
	});

	it('matches by sku case-insensitively', () => {
		expect(filterStockFormItems(items, 'wat-01').map((i) => i._id)).toEqual(['item_master:water']);
	});

	it('matches fuzzy typos in the name', () => {
		expect(filterStockFormItems(items, 'ขวาสาร').map((i) => i._id)).toEqual(['item:rice']);
		expect(filterStockFormItems(items, 'ข้าวสา').map((i) => i._id)).toContain('item:rice');
	});

	it('matches sku without separators', () => {
		expect(filterStockFormItems(items, 'WAT01').map((i) => i._id)).toEqual(['item_master:water']);
	});

	it('returns no items for an unrelated query', () => {
		expect(filterStockFormItems(items, 'xyzzy')).toEqual([]);
	});

	it('ranks closer name matches before weaker ones', () => {
		const mixed = toStockFormItems(
			[
				{ _id: 'item:a', name: 'ถุงมือยาง', unit: 'pair', perishable: false },
				{ _id: 'item:b', name: 'ถุงมือผ้า', unit: 'pair', perishable: false }
			],
			[]
		);
		expect(filterStockFormItems(mixed, 'ถุงมือยาง').map((i) => i._id)[0]).toBe('item:a');
	});
});

describe('barcode lookup', () => {
	const items = toStockFormItems(
		[],
		[
			{
				_id: 'item_master:milk',
				name: 'นมถั่วเหลือง',
				base_unit: 'box',
				conversions: [
					{ uom_name: 'pack', multiplier: '12', barcode: '8850000000999' },
					{ uom_name: 'box', multiplier: '1', barcode: '8850000000012' }
				]
			},
			{ _id: 'item_master:water', name: 'น้ำดื่ม', base_unit: 'bottle', conversions: [] }
		]
	);

	it('keeps barcodes on the packaging rows', () => {
		expect(items[0].conversions?.[1].barcode).toBe('8850000000012');
	});

	it('puts the item with a matching barcode first', () => {
		expect(filterStockFormItems(items, '8850000000012').map((i) => i._id)).toEqual([
			'item_master:milk'
		]);
		const hits = filterStockFormItems(items, ' 8850000000999 ');
		expect(hits[0]._id).toBe('item_master:milk');
	});

	it('does not duplicate an item that also matches by name', () => {
		const out = filterStockFormItems(items, 'นม');
		expect(out.filter((i) => i._id === 'item_master:milk')).toHaveLength(1);
	});

	it('returns nothing for an unknown barcode', () => {
		expect(filterStockFormItems(items, '0000000000000')).toEqual([]);
	});
});
