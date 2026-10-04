import { describe, expect, it } from 'vitest';
import { createItemMaster, itemMasterInputSchema } from './catalog';
import {
	buildQuickCreateInput,
	quickCreateTypeClass,
	validateQuickCreate,
	type QuickCreateDraft
} from './quick-create';

const categories = [
	{ _id: 'item_category:food', default_class: 'CONSUMABLE' as const },
	{ _id: 'item_category:bedding', default_class: 'DURABLE' as const },
	{ _id: 'item_category:kits', default_class: 'EQUIPMENT' as const },
	{ _id: 'item_category:other' }
];

const draft = (over: Partial<QuickCreateDraft> = {}): QuickCreateDraft => ({
	name: ' นมถั่วเหลือง 300 มล. ',
	categoryId: 'item_category:food',
	baseUnit: 'box',
	...over
});

describe('quickCreateTypeClass', () => {
	it('follows the category default, else consumable', () => {
		expect(quickCreateTypeClass('item_category:bedding', categories)).toBe('DURABLE');
		expect(quickCreateTypeClass('item_category:other', categories)).toBe('CONSUMABLE');
		expect(quickCreateTypeClass(undefined, categories)).toBe('CONSUMABLE');
	});
});

describe('validateQuickCreate', () => {
	it('passes with name, category and base unit', () => {
		expect(validateQuickCreate(draft(), { requireCategory: true })).toEqual({});
	});

	it('reports each missing required field', () => {
		const errors = validateQuickCreate(draft({ name: ' ', categoryId: undefined, baseUnit: '' }), {
			requireCategory: true
		});
		expect(Object.keys(errors).sort()).toEqual(['baseUnit', 'category', 'name']);
	});

	it('does not require a category unless asked', () => {
		expect(validateQuickCreate(draft({ categoryId: undefined }))).toEqual({});
	});

	it('rejects a pack row with a bad multiplier or the base unit', () => {
		expect(validateQuickCreate(draft({ packUnit: 'pack', packMultiplier: '0' })).pack).toBeTruthy();
		expect(validateQuickCreate(draft({ packUnit: 'pack', packMultiplier: '' })).pack).toBeTruthy();
		expect(validateQuickCreate(draft({ packUnit: 'box', packMultiplier: '12' })).pack).toBeTruthy();
		expect(
			validateQuickCreate(draft({ packUnit: 'pack', packMultiplier: '12' })).pack
		).toBeUndefined();
	});
});

describe('buildQuickCreateInput', () => {
	it('builds a consumable that satisfies the item master schema', () => {
		const input = buildQuickCreateInput(draft(), categories);
		expect(input).toMatchObject({
			name: 'นมถั่วเหลือง 300 มล.',
			category: 'item_category:food',
			type_class: 'CONSUMABLE',
			base_unit: 'box',
			conversions: [],
			distribution_type: 'recurring',
			storage_type: 'DRY'
		});
		expect(itemMasterInputSchema.safeParse(input).success).toBe(true);
	});

	it('adds the pack row and default receive unit', () => {
		const input = buildQuickCreateInput(
			draft({ packUnit: 'pack', packMultiplier: '12', packAsDefault: true }),
			categories
		);
		expect(input.conversions).toEqual([{ uom_name: 'pack', multiplier: '12' }]);
		expect(input.default_inventory_uom).toBe('pack');
	});

	it('does not set a default unit unless asked', () => {
		const input = buildQuickCreateInput(
			draft({ packUnit: 'pack', packMultiplier: '12' }),
			categories
		);
		expect(input.default_inventory_uom).toBeUndefined();
	});

	it('stores the barcode on a base-unit row after the pack rows', () => {
		const input = buildQuickCreateInput(
			draft({ packUnit: 'pack', packMultiplier: '12', barcode: ' 8850000000012 ' }),
			categories
		);
		expect(input.conversions).toEqual([
			{ uom_name: 'pack', multiplier: '12' },
			{ uom_name: 'box', multiplier: '1', barcode: '8850000000012' }
		]);
	});

	it('omits consumable-only storage for durables and sets READY for equipment', () => {
		const durable = buildQuickCreateInput(
			draft({ categoryId: 'item_category:bedding' }),
			categories
		);
		expect(durable.type_class).toBe('DURABLE');
		expect(durable.storage_type).toBeUndefined();

		const equipment = buildQuickCreateInput(
			draft({ categoryId: 'item_category:kits' }),
			categories
		);
		expect(equipment.type_class).toBe('EQUIPMENT');
		expect(equipment.asset_status).toBe('READY');
		expect(equipment.distribution_type).toBeUndefined();
		expect(itemMasterInputSchema.safeParse(equipment).success).toBe(true);
	});

	it('produces an item master with the base-unit barcode row and a chosen storage', () => {
		const input = buildQuickCreateInput(
			draft({ storage: 'CHILLED', barcode: '8850000000012' }),
			categories
		);
		const doc = createItemMaster(input, { shelterCode: 'SH001', createdBy: 'tester' }, 'SH001');
		expect(doc.storage_type).toBe('CHILLED');
		expect(doc.conversions).toEqual([
			{ uom_name: 'box', multiplier: '1', barcode: '8850000000012' }
		]);
		expect(doc.shelter_code).toBe('SH001');
	});

	it('allows an item with no category', () => {
		const input = buildQuickCreateInput(draft({ categoryId: undefined }), categories);
		expect(input.category).toBeUndefined();
		expect(itemMasterInputSchema.safeParse(input).success).toBe(true);
	});
});
