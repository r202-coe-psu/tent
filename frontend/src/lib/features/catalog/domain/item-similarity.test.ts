import { describe, expect, it } from 'vitest';
import type { ItemMaster } from './catalog';
import { findSimilarItems, missingOptionalFields } from './item-similarity';

const base = { created_at: '', updated_at: '', created_by: 'test' };

function item(over: Partial<ItemMaster> & { _id: string; name: string }): ItemMaster {
	return {
		...base,
		type: 'item_master',
		schema_v: 4,
		base_unit: 'box',
		conversions: [],
		type_class: 'CONSUMABLE',
		dietary: [],
		...over
	} as ItemMaster;
}

describe('findSimilarItems', () => {
	const items = [
		item({ _id: 'a', name: 'นมถั่วเหลือง UHT 250 มล.' }),
		item({ _id: 'b', name: 'นม UHT รสจืด 200 มล.' }),
		item({ _id: 'c', name: 'น้ำดื่ม 600 มล.' }),
		item({ _id: 'd', name: 'นมถั่วเหลือง 300 มล. (เลิกขาย)', deactivated: true })
	];

	it('finds items whose name contains or is contained in the query', () => {
		const hits = findSimilarItems('นมถั่วเหลือง', items);
		expect(hits.map((i) => i._id)).toContain('a');
	});

	it('finds near matches despite size words and spacing', () => {
		const hits = findSimilarItems('นมถั่วเหลือง 300 มล.', items);
		expect(hits.map((i) => i._id)).toContain('a');
		expect(hits.map((i) => i._id)).not.toContain('c');
	});

	it('ignores case and whitespace', () => {
		const hits = findSimilarItems('นม uht รสจืด 200มล.', items);
		expect(hits[0]?._id).toBe('b');
	});

	it('skips deactivated items', () => {
		expect(
			findSimilarItems('นมถั่วเหลือง 300 มล. (เลิกขาย)', items).map((i) => i._id)
		).not.toContain('d');
	});

	it('returns nothing for a too-short or unrelated name', () => {
		expect(findSimilarItems('ก', items)).toEqual([]);
		expect(findSimilarItems('   ', items)).toEqual([]);
		expect(findSimilarItems('ผ้าห่มกันหนาว', items)).toEqual([]);
	});

	it('honours the limit', () => {
		const many = Array.from({ length: 6 }, (_, i) => item({ _id: `n${i}`, name: `ข้าวสาร ${i}` }));
		expect(findSimilarItems('ข้าวสาร', many, { limit: 2 })).toHaveLength(2);
	});
});

describe('missingOptionalFields', () => {
	it('lists every gap on a bare consumable', () => {
		expect(missingOptionalFields(item({ _id: 'x', name: 'x' }))).toEqual([
			'SKU',
			'ขนาดบรรจุ',
			'อายุเก็บรักษา',
			'การเก็บรักษา',
			'สารก่อภูมิแพ้',
			'กลุ่มผู้รับ'
		]);
	});

	it('is empty for a complete consumable', () => {
		const full = item({
			_id: 'x',
			name: 'x',
			sku: 'MILK-1',
			conversions: [{ uom_name: 'pack', multiplier: '12' }],
			shelf_life_days: 180,
			storage_type: 'DRY',
			allergens: 'ถั่วเหลือง',
			target_gender: 'ALL'
		});
		expect(missingOptionalFields(full)).toEqual([]);
	});

	it('does not count the base-unit barcode row as a pack size', () => {
		const onlyBase = item({
			_id: 'x',
			name: 'x',
			conversions: [{ uom_name: 'box', multiplier: '1', barcode: '8850000000012' }]
		});
		expect(missingOptionalFields(onlyBase)).toContain('ขนาดบรรจุ');
	});

	it('does not ask fuel for allergens', () => {
		const fuel = item({ _id: 'x', name: 'x', category: 'item_category:fuel_energy' });
		expect(missingOptionalFields(fuel)).not.toContain('สารก่อภูมิแพ้');
	});

	it('only lists fields that apply to the type class', () => {
		const durable = item({ _id: 'x', name: 'x', type_class: 'DURABLE' });
		expect(missingOptionalFields(durable)).toEqual(['SKU', 'ขนาดบรรจุ', 'กลุ่มผู้รับ']);
		const equipment = item({ _id: 'x', name: 'x', type_class: 'EQUIPMENT' });
		expect(missingOptionalFields(equipment)).toEqual(['SKU']);
	});

	it('flags a legacy doc with no type_class', () => {
		const legacy = item({ _id: 'x', name: 'x', type_class: undefined as never });
		expect(missingOptionalFields(legacy)[0]).toBe('ประเภท');
	});
});
