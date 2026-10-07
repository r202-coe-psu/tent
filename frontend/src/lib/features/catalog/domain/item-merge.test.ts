import { describe, expect, it } from 'vitest';
import type { ItemMaster } from './catalog';
import { createItemMaster, ITEM_MASTER_SCHEMA_V, mergeCatalogGenerations } from './catalog';
import {
	canMergeItem,
	convertItemQty,
	isMergedItem,
	isShelterLocalItem,
	mergedAliasesByTarget,
	resolveItemUnitConversion
} from './item-merge';

const item = (over: Partial<ItemMaster> & { _id: string; name: string }): ItemMaster =>
	({ base_unit: 'bottle', conversions: [], ...over }) as ItemMaster;

describe('item_master schema_v 5 (CR-143 §F)', () => {
	it('stamps schema_v 5 on a newly created item', () => {
		const doc = createItemMaster(
			{
				name: 'น้ำ',
				base_unit: 'bottle',
				type_class: 'CONSUMABLE',
				distribution_type: 'recurring'
			},
			{ shelterCode: 'SH001', createdBy: 'staff' },
			'SH001'
		);
		expect(ITEM_MASTER_SCHEMA_V).toBe(5);
		expect(doc.schema_v).toBe(5);
		expect(doc.merged_into).toBeUndefined();
	});
});

describe('merged_into visibility (FR-F5)', () => {
	it('detects a merged-away item', () => {
		expect(isMergedItem({ merged_into: 'item_master:B' })).toBe(true);
		expect(isMergedItem({})).toBe(false);
		expect(isMergedItem({ merged_into: '' })).toBe(false);
	});

	it('maps each destination to the names merged into it', () => {
		const aliases = mergedAliasesByTarget([
			{ name: 'A1', merged_into: 'item_master:B' },
			{ name: 'A2', merged_into: 'item_master:B' },
			{ name: 'C', merged_into: 'item_master:D' },
			{ name: 'B' }
		]);
		expect(aliases.get('item_master:B')).toEqual(['A1', 'A2']);
		expect(aliases.get('item_master:D')).toEqual(['C']);
		expect(aliases.has('item_master:A')).toBe(false);
	});

	it('mergeCatalogGenerations never offers a merged-away master, even if left active', () => {
		const entries = mergeCatalogGenerations(
			[],
			[
				{ _id: 'item_master:A', name: 'A', base_unit: 'kg', merged_into: 'item_master:B' },
				{ _id: 'item_master:B', name: 'B', base_unit: 'kg' }
			]
		);
		expect(entries.map((e) => e._id)).toEqual(['item_master:B']);
	});
});

describe('canMergeItem (FR-F4)', () => {
	const local = item({ _id: 'item_master:L', name: 'l', shelter_code: 'SH001' });
	const central = item({ _id: 'item_master:C', name: 'c' });
	const override = item({ _id: 'item_master:C', name: 'c', shelter_code: 'SH001', override: true });

	it('recognises a shelter-local item only for its own shelter', () => {
		expect(isShelterLocalItem(local, 'SH001')).toBe(true);
		expect(isShelterLocalItem(local, 'sh001')).toBe(true);
		expect(isShelterLocalItem(local, 'SH002')).toBe(false);
		expect(isShelterLocalItem(local, null)).toBe(false);
		expect(isShelterLocalItem(central, 'SH001')).toBe(false);
		expect(isShelterLocalItem(override, 'SH001')).toBe(false);
	});

	it('local item: SA, or that shelter manager / warehouse_staff', () => {
		expect(canMergeItem(['system_admin'], 'SH001', local)).toBe(true);
		expect(canMergeItem(['shelter:SH001', 'SH001:shelter_manager'], 'SH001', local)).toBe(true);
		expect(canMergeItem(['shelter:SH001', 'SH001:warehouse_staff'], 'SH001', local)).toBe(true);
		expect(canMergeItem(['shelter:SH001', 'SH001:supply_coordinator'], 'SH001', local)).toBe(false);
		expect(canMergeItem(['shelter:SH002', 'SH002:shelter_manager'], 'SH001', local)).toBe(false);
	});

	it('central item (and an override of one): SA only', () => {
		const manager = ['shelter:SH001', 'SH001:shelter_manager'];
		expect(canMergeItem(['system_admin'], 'SH001', central)).toBe(true);
		expect(canMergeItem(manager, 'SH001', central)).toBe(false);
		expect(canMergeItem(manager, 'SH001', override)).toBe(false);
		expect(canMergeItem(manager, null, central)).toBe(false);
	});
});

describe('unit compatibility (FR-F3)', () => {
	it('same base unit needs no conversion', () => {
		expect(
			resolveItemUnitConversion(item({ _id: 'a', name: 'a' }), item({ _id: 'b', name: 'b' }))
		).toEqual({
			kind: 'same'
		});
	});

	it('is incompatible when neither item knows the other unit', () => {
		expect(
			resolveItemUnitConversion(
				item({ _id: 'a', name: 'a', base_unit: 'bottle' }),
				item({ _id: 'b', name: 'b', base_unit: 'liter' })
			)
		).toBeNull();
	});

	it('multiplies when the destination lists the source unit', () => {
		const conv = resolveItemUnitConversion(
			item({ _id: 'a', name: 'a', base_unit: 'bottle' }),
			item({
				_id: 'b',
				name: 'b',
				base_unit: 'pack',
				conversions: [{ uom_name: 'bottle', multiplier: '0.5' }]
			})
		);
		expect(conv).toEqual({ kind: 'multiply', factor: '0.5' });
		expect(convertItemQty('24', conv!)).toBe('12');
	});

	it('divides when the source lists the destination unit, and refuses inexact results', () => {
		const conv = resolveItemUnitConversion(
			item({
				_id: 'a',
				name: 'a',
				base_unit: 'bottle',
				conversions: [{ uom_name: 'crate', multiplier: '6' }]
			}),
			item({ _id: 'b', name: 'b', base_unit: 'crate' })
		);
		expect(conv).toEqual({ kind: 'divide', divisor: '6' });
		expect(convertItemQty('24', conv!)).toBe('4');
		expect(convertItemQty('7', conv!)).toBeNull();
	});
});
