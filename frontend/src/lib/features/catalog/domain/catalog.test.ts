import { describe, it, expect } from 'vitest';
import {
	createItemMaster,
	isItemMaster,
	itemMasterInputSchema,
	itemMasterUpdateInputSchema,
	createItemCategory,
	isItemCategory,
	itemCategoryInputSchema,
	createRecipe,
	isRecipe,
	recipeInputSchema,
	mergeCatalogGenerations,
	resolveCategoryId,
	resolveCategoryLabel,
	itemBelongsToCategory,
	catalogOrigin,
	canShelterDeleteCatalogDoc,
	itemSelectableUoms,
	qtyToBaseUnit,
	qtyFromBaseUnit,
	toLedgerQtyUnit,
	defaultInventoryUom,
	defaultIssueUom,
	packagingMultiplier,
	requiresExpiry,
	suggestExpiry,
	shelfLifeExpiryLabel,
	expiryRequirementHint
} from './catalog';
import type { AuthorContext } from '$lib/db/model';

describe('catalog domain', () => {
	const ctx: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'test-user'
	};

	it('should validate valid item master input', () => {
		const input = {
			name: 'ข้าวสาร',
			base_unit: 'kg',
			conversions: [],
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const
		};
		const parsed = itemMasterInputSchema.parse(input);
		expect(parsed.name).toBe('ข้าวสาร');
		expect(parsed.base_unit).toBe('kg');
	});

	it('should create item master doc', () => {
		const input = {
			name: 'ยาพาราเซตามอล',
			base_unit: 'tablet',
			conversions: [],
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const
		};

		const doc = createItemMaster(input, ctx);
		expect(doc._id).toMatch(/^item_master:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(doc.type).toBe('item_master');
		expect(doc.name).toBe('ยาพาราเซตามอล');
		expect(isItemMaster(doc)).toBe(true);
	});

	it('should validate valid item category input', () => {
		const input = {
			name: 'อาหารแห้ง'
		};
		const parsed = itemCategoryInputSchema.parse(input);
		expect(parsed.name).toBe('อาหารแห้ง');
	});

	it('should create item category doc with item_category: prefix', () => {
		const input = {
			name: 'เครื่องมือแพทย์'
		};
		const doc = createItemCategory(input, ctx);
		expect(doc._id).toMatch(/^item_category:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(doc.type).toBe('item_category');
		expect(doc.name).toBe('เครื่องมือแพทย์');
		expect(doc.is_protected).toBe(false);
		expect(isItemCategory(doc)).toBe(true);
	});

	it('resolves category refs by id, system name, and legacy Thai name', () => {
		const cats = [
			{
				_id: 'item_category:food',
				name: 'อาหารและวัตถุดิบ (Food Ingredients)',
				system_key: 'FOOD' as const
			}
		];
		expect(resolveCategoryId('item_category:food', cats)).toBe('item_category:food');
		expect(resolveCategoryId('อาหารและวัตถุดิบ', cats)).toBe('item_category:food');
		expect(resolveCategoryId('unknown', cats)).toBeUndefined();
		expect(itemBelongsToCategory({ category: 'อาหารและวัตถุดิบ' }, cats[0])).toBe(true);
		expect(catalogOrigin({ shelter_code: 'SH001' }, 'SH001')).toBe('local');
		expect(catalogOrigin({ shelter_code: 'SH001', override: true }, 'SH001')).toBe('override');
		expect(catalogOrigin({}, 'SH001')).toBe('central');
		expect(canShelterDeleteCatalogDoc({ shelter_code: 'SH001' }, 'SH001')).toBe(true);
		expect(canShelterDeleteCatalogDoc({}, 'SH001')).toBe(false);
	});

	it('resolveCategoryLabel returns human-readable names for system ids', () => {
		expect(resolveCategoryLabel('item_category:food')).toBe('อาหารและวัตถุดิบ (Food Ingredients)');
		expect(resolveCategoryLabel('อาหารและวัตถุดิบ')).toBe('อาหารและวัตถุดิบ (Food Ingredients)');
		expect(
			resolveCategoryLabel('item_category:food', [
				{
					_id: 'item_category:food',
					name: 'อาหารและวัตถุดิบ',
					system_key: 'FOOD'
				}
			])
		).toBe('อาหารและวัตถุดิบ');
		expect(resolveCategoryLabel('unknown-cat')).toBe('unknown-cat');
		expect(resolveCategoryLabel('')).toBe('');
	});

	it('rejects duplicate conversion uom codes on one item', () => {
		expect(() =>
			itemMasterInputSchema.parse({
				name: 'ข้าวสาร',
				base_unit: 'kg',
				type_class: 'CONSUMABLE',
				distribution_type: 'recurring',
				conversions: [
					{ uom_name: 'bag', multiplier: '5' },
					{ uom_name: 'bag', multiplier: '50' }
				]
			})
		).toThrow();
	});

	it('should validate valid recipe input', () => {
		const input = {
			label: 'ข้าวผัดไข่มาตรฐาน',
			ingredients: [
				{ item_master_id: 'item_master_rice_123', quantity: 10, uom: 'kg' },
				{ item_master_id: 'item_master_egg_123', quantity: 100, uom: 'piece' }
			],
			standard_portions: 100,
			standard_duration_hours: 1.5
		};
		const parsed = recipeInputSchema.parse(input);
		expect(parsed.label).toBe('ข้าวผัดไข่มาตรฐาน');
		expect(parsed.ingredients).toHaveLength(2);
		expect(parsed.standard_portions).toBe('100');
	});

	it('should create recipe doc with recipe: prefix', () => {
		const input = {
			label: 'แกงจืดเต้าหู้หมูสับ',
			ingredients: [{ item_master_id: 'item_master_tofu_123', quantity: '50', uom: 'tube' }],
			standard_portions: '50',
			standard_duration_hours: '0.5'
		};
		const doc = createRecipe(input, ctx);
		expect(doc._id).toMatch(/^recipe:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(doc.type).toBe('recipe');
		expect(doc.label).toBe('แกงจืดเต้าหู้หมูสับ');
		expect(isRecipe(doc)).toBe(true);
	});

	it('should validate conversions multiplier > 0 and allow fractions like 0.5', () => {
		const baseInput = {
			name: 'น้ำดื่ม',
			base_unit: 'bottle',
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const
		};

		// 0.5 is valid
		const validParsed = itemMasterInputSchema.parse({
			...baseInput,
			conversions: [{ uom_name: 'pack', multiplier: 0.5 }]
		});
		expect(validParsed.conversions[0].multiplier).toBe('0.5');

		// 0 is invalid
		expect(() =>
			itemMasterInputSchema.parse({
				...baseInput,
				conversions: [{ uom_name: 'pack', multiplier: 0 }]
			})
		).toThrow();

		// -1 is invalid
		expect(() =>
			itemMasterInputSchema.parse({
				...baseInput,
				conversions: [{ uom_name: 'pack', multiplier: -1 }]
			})
		).toThrow();
	});

	it('should validate ingredients quantity > 0 and allow fractions like 0.5', () => {
		const baseRecipeInput = {
			label: 'น้ำพริก',
			standard_portions: 10,
			standard_duration_hours: 0.5
		};

		// 0.5 is valid
		const validParsed = recipeInputSchema.parse({
			...baseRecipeInput,
			ingredients: [{ item_master_id: 'item_1', quantity: 0.5, uom: 'kg' }]
		});
		expect(validParsed.ingredients[0].quantity).toBe('0.5');

		// 0 is invalid
		expect(() =>
			recipeInputSchema.parse({
				...baseRecipeInput,
				ingredients: [{ item_master_id: 'item_1', quantity: 0, uom: 'kg' }]
			})
		).toThrow();

		// -1 is invalid
		expect(() =>
			recipeInputSchema.parse({
				...baseRecipeInput,
				ingredients: [{ item_master_id: 'item_1', quantity: -1, uom: 'kg' }]
			})
		).toThrow();
	});

	it('should support deactivated field defaulting to false and accepting true', () => {
		const baseInput = {
			name: 'น้ำดื่ม',
			base_unit: 'bottle',
			conversions: [],
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const
		};

		const defaultParsed = itemMasterInputSchema.parse(baseInput);
		expect(defaultParsed.deactivated).toBeUndefined();

		const docWithDefault = createItemMaster(baseInput, ctx);
		expect(docWithDefault.deactivated).toBe(false);

		const deactivatedInput = {
			...baseInput,
			deactivated: true
		};
		const deactivatedParsed = itemMasterInputSchema.parse(deactivatedInput);
		expect(deactivatedParsed.deactivated).toBe(true);

		const docWithDeactivated = createItemMaster(deactivatedInput, ctx);
		expect(docWithDeactivated.deactivated).toBe(true);
	});

	it('should support deactivated field for Recipe defaulting to false and accepting true', () => {
		const baseInput = {
			label: 'น้ำพริก',
			ingredients: [{ item_master_id: 'item_1', quantity: '0.5', uom: 'kg' }],
			standard_portions: '10',
			standard_duration_hours: '0.5'
		};

		const defaultParsed = recipeInputSchema.parse(baseInput);
		expect(defaultParsed.deactivated).toBeUndefined();

		const docWithDefault = createRecipe(baseInput, ctx);
		expect(docWithDefault.deactivated).toBe(false);

		const deactivatedInput = {
			...baseInput,
			deactivated: true
		};
		const deactivatedParsed = recipeInputSchema.parse(deactivatedInput);
		expect(deactivatedParsed.deactivated).toBe(true);

		const docWithDeactivated = createRecipe(deactivatedInput, ctx);
		expect(docWithDeactivated.deactivated).toBe(true);
	});

	it('should support item class specific validations and fields', () => {
		// Consumable
		const consumableInput = {
			name: 'นมสด',
			base_unit: 'bottle',
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const,
			shelf_life_days: 7,
			storage_type: 'CHILLED' as const,
			allergens: 'นม'
		};
		const consumableParsed = itemMasterInputSchema.parse(consumableInput);
		expect(consumableParsed.shelf_life_days).toBe(7);
		expect(consumableParsed.storage_type).toBe('CHILLED');

		const consumableDoc = createItemMaster(consumableInput, ctx);
		expect(consumableDoc.shelf_life_days).toBe(7);

		// Durable
		const durableInput = {
			name: 'เต็นท์พักแรม',
			base_unit: 'unit',
			distribution_type: 'one_time' as const,
			type_class: 'DURABLE' as const,
			qty_per_person: 0.5,
			returnable: true
		};
		const durableParsed = itemMasterInputSchema.parse(durableInput);
		expect(durableParsed.qty_per_person).toBe(0.5);
		expect(durableParsed.returnable).toBe(true);

		const durableDoc = createItemMaster(durableInput, ctx);
		expect(durableDoc.qty_per_person).toBe(0.5);
		expect(durableDoc.returnable).toBe(true);

		// Equipment
		const equipmentInput = {
			name: 'เครื่องปั่นไฟ',
			type_class: 'EQUIPMENT' as const,
			asset_status: 'READY' as const
		};
		const equipmentParsed = itemMasterInputSchema.parse(equipmentInput);
		expect(equipmentParsed.asset_status).toBe('READY');
		expect(equipmentParsed.base_unit).toBeUndefined();

		const equipmentDoc = createItemMaster(equipmentInput, ctx);
		expect(equipmentDoc.asset_status).toBe('READY');
		expect(equipmentDoc.base_unit).toBe('piece');
	});

	it('should enforce required fields conditionally and reject non-code base_unit', () => {
		// For Consumable/Durable, base_unit is required
		expect(() =>
			itemMasterInputSchema.parse({
				name: 'นมสด',
				distribution_type: 'recurring' as const,
				type_class: 'CONSUMABLE' as const
			})
		).toThrow();

		// base_unit must be lowercase English code (reject Thai labels)
		expect(() =>
			itemMasterInputSchema.parse({
				name: 'ข้าวสาร',
				base_unit: 'กิโลกรัม',
				distribution_type: 'recurring' as const,
				type_class: 'CONSUMABLE' as const
			})
		).toThrow(/Base unit must be a valid lowercase English code/);

		expect(() =>
			itemMasterInputSchema.parse({
				name: 'ข้าวสาร',
				base_unit: 'ชิ้น',
				distribution_type: 'recurring' as const,
				type_class: 'CONSUMABLE' as const
			})
		).toThrow(/Base unit must be a valid lowercase English code/);

		// For Consumable/Durable, distribution_type is required
		expect(() =>
			itemMasterInputSchema.parse({
				name: 'นมสด',
				base_unit: 'bottle',
				type_class: 'CONSUMABLE' as const
			})
		).toThrow();

		// For Equipment, asset_status is required
		expect(() =>
			itemMasterInputSchema.parse({
				name: 'เครื่องปั่นไฟ',
				type_class: 'EQUIPMENT' as const
			})
		).toThrow();
	});

	it('allows known legacy base_unit labels only for updates', () => {
		const legacy = itemMasterUpdateInputSchema.parse({
			name: 'ข้าวสารเดิม',
			base_unit: 'กิโลกรัม',
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const
		});
		expect(legacy.base_unit).toBe('กิโลกรัม');

		expect(() =>
			itemMasterUpdateInputSchema.parse({
				name: 'ข้าวสารใหม่',
				base_unit: 'หน่วยเดิมที่ไม่รู้จัก',
				distribution_type: 'recurring' as const,
				type_class: 'CONSUMABLE' as const
			})
		).toThrow(/Base unit must be a valid lowercase English code/);
	});
});

// `item_master` replaces `supply_item` (schema.md §4.2) but the migration has not
// run, so the seed carries both generations of the same goods. Item pickers listed
// the two sources back to back and showed "ข้าวสาร (kg)" twice — with no way to see
// which id was being bound.
describe('mergeCatalogGenerations', () => {
	const supply = [
		{ _id: 'item:rice', name: 'ข้าวสาร', unit: 'kg', category: 'food', perishable: false },
		{ _id: 'item:water', name: 'น้ำดื่ม', unit: 'bottle', category: 'water', perishable: false }
	];
	const masters = [
		{ _id: 'item_master:rice', name: 'ข้าวสาร', base_unit: 'kg', category: 'food' },
		{ _id: 'item_master:canned-fish', name: 'ปลากระป๋อง', base_unit: 'can', category: 'food' }
	];

	it('lists each item once', () => {
		const merged = mergeCatalogGenerations(supply, masters);
		expect(merged.map((m) => m.name)).toEqual(['ข้าวสาร', 'น้ำดื่ม', 'ปลากระป๋อง']);
	});

	// Every stock_ledger row and campaign need in the data is an `item:` id; binding a
	// new campaign to `item_master:rice` would open a second donor card for rice.
	it('keeps the legacy id when the same item exists in both generations', () => {
		const merged = mergeCatalogGenerations(supply, masters);
		expect(merged.find((m) => m.name === 'ข้าวสาร')?._id).toBe('item:rice');
	});

	it('keeps an item_master that has no legacy twin', () => {
		const merged = mergeCatalogGenerations(supply, masters);
		expect(merged.find((m) => m.name === 'ปลากระป๋อง')?._id).toBe('item_master:canned-fish');
	});

	it('resolves the item_master unit through base_unit', () => {
		const merged = mergeCatalogGenerations([], masters);
		expect(merged.find((m) => m.name === 'ปลากระป๋อง')?.unit).toBe('can');
	});

	it('drops deactivated item masters', () => {
		const merged = mergeCatalogGenerations(
			[],
			[{ _id: 'item_master:old', name: 'เลิกใช้', base_unit: 'ชิ้น', deactivated: true }]
		);
		expect(merged).toEqual([]);
	});

	// Names arrive from two different seeds; a stray space must not defeat the match.
	it('matches names ignoring case and surrounding space', () => {
		const merged = mergeCatalogGenerations(
			[{ _id: 'item:soap', name: ' สบู่ก้อน ', unit: 'bar', category: 'hygiene' }],
			[{ _id: 'item_master:soap', name: 'สบู่ก้อน', base_unit: 'bar' }]
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]._id).toBe('item:soap');
	});
});

describe('packaging UOM conversion', () => {
	const rice = {
		base_unit: 'kg',
		conversions: [
			{ uom_name: 'bag', multiplier: '5' },
			{ uom_name: 'sack', multiplier: '50' }
		],
		default_inventory_uom: 'sack',
		default_issue_uom: 'bag'
	};

	it('lists base plus each packaging UOM once', () => {
		expect(itemSelectableUoms(rice).map((o) => o.code)).toEqual(['kg', 'bag', 'sack']);
		expect(itemSelectableUoms(rice).find((o) => o.code === 'sack')?.multiplier).toBe('50');
	});

	it('converts packaging qty to base units for ledger write', () => {
		expect(qtyToBaseUnit('2', 'sack', rice)).toBe('100');
		expect(toLedgerQtyUnit('2', 'sack', rice)).toEqual({ qty: '100', unit: 'kg' });
		expect(qtyFromBaseUnit('100', 'sack', rice)).toBe('2');
	});

	it('defaults receive/issue UOMs when they are selectable', () => {
		expect(defaultInventoryUom(rice)).toBe('sack');
		expect(defaultIssueUom(rice)).toBe('bag');
		expect(defaultInventoryUom({ base_unit: 'piece', conversions: [] })).toBe('piece');
		expect(
			defaultIssueUom({
				base_unit: 'kg',
				conversions: [{ uom_name: 'bag', multiplier: '5' }],
				default_issue_uom: 'missing'
			})
		).toBe('kg');
	});

	it('rejects unknown packaging codes', () => {
		expect(() => qtyToBaseUnit('1', 'crate', rice)).toThrow(/Unknown unit/);
		expect(packagingMultiplier(rice, 'kg')).toBe('1');
	});
});

// CR-143 §D — `item_master` has no `perishable` field, so the old code hardcoded
// `perishable: false` for every master and never demanded an expiry date.
describe('requiresExpiry (FR-D1, FR-D3)', () => {
	it('is true for CHILLED and FROZEN storage', () => {
		expect(requiresExpiry({ storage_type: 'CHILLED' })).toBe(true);
		expect(requiresExpiry({ storage_type: 'FROZEN' })).toBe(true);
	});

	it('is false for DRY with no shelf life (AC-D2)', () => {
		expect(requiresExpiry({ storage_type: 'DRY' })).toBe(false);
		expect(requiresExpiry({ storage_type: 'DRY', shelf_life_days: undefined })).toBe(false);
		expect(requiresExpiry({})).toBe(false);
	});

	it('is false for CONTROLLED_MED on its own', () => {
		expect(requiresExpiry({ storage_type: 'CONTROLLED_MED' })).toBe(false);
	});

	it('is true whenever shelf_life_days is set, whatever the storage', () => {
		expect(requiresExpiry({ storage_type: 'DRY', shelf_life_days: 180 })).toBe(true);
		expect(requiresExpiry({ shelf_life_days: 30 })).toBe(true);
		expect(requiresExpiry({ shelf_life_days: null })).toBe(false);
	});

	it('stays true for a legacy supply_item.perishable (OR with FR-D1)', () => {
		expect(requiresExpiry({ perishable: true })).toBe(true);
		expect(requiresExpiry({ perishable: false })).toBe(false);
		expect(requiresExpiry({ perishable: true, storage_type: 'DRY' })).toBe(true);
	});
});

describe('suggestExpiry (FR-D2a, FR-D2c)', () => {
	const dry180 = { storage_type: 'DRY' as const, shelf_life_days: 180 };

	// AC-D3: received 2 Oct 2569 (= 2026-10-02), no production date -> 31 Mar 2570.
	it('adds shelf_life_days to the receive date when there is no production date', () => {
		expect(suggestExpiry(dry180, '', '2026-10-02')).toEqual({
			expiry: '2027-03-31',
			shelfLifeDays: 180
		});
		expect(suggestExpiry(dry180, undefined, '2026-10-02')?.expiry).toBe('2027-03-31');
	});

	// AC-D4: produced 1 Sep 2569 -> 28 Feb 2570.
	it('prefers the production date over the receive date', () => {
		expect(suggestExpiry(dry180, '2026-09-01', '2026-10-02')?.expiry).toBe('2027-02-28');
	});

	it('returns null for CHILLED / FROZEN without shelf_life_days (they must be keyed by hand)', () => {
		expect(suggestExpiry({ storage_type: 'CHILLED' }, '', '2026-10-02')).toBeNull();
		expect(suggestExpiry({ storage_type: 'FROZEN' }, '2026-09-01', '2026-10-02')).toBeNull();
	});

	it('returns null for an item that does not require expiry, and for a non-positive shelf life', () => {
		expect(suggestExpiry({ storage_type: 'DRY' }, '', '2026-10-02')).toBeNull();
		expect(suggestExpiry({ shelf_life_days: 0 }, '', '2026-10-02')).toBeNull();
	});

	it('falls back to the receive date when the production date is not a valid date', () => {
		expect(suggestExpiry(dry180, 'garbage', '2026-10-02')?.expiry).toBe('2027-03-31');
	});

	it('returns null when the base date is unusable', () => {
		expect(suggestExpiry(dry180, '', 'nope')).toBeNull();
	});

	it('crosses a leap day without drifting', () => {
		expect(suggestExpiry({ shelf_life_days: 365 }, '2027-12-31', '2028-01-05')?.expiry).toBe(
			'2028-12-30'
		);
	});
});

describe('shelfLifeExpiryLabel (FR-D2b)', () => {
	it('uses the exact owner-approved Thai wording', () => {
		expect(shelfLifeExpiryLabel(180)).toBe(
			'คำนวณจากอายุเก็บรักษา 180 วัน — กรุณาตรวจสอบกับฉลากอีกครั้ง'
		);
	});
});

describe('expiryRequirementHint (FR-D4)', () => {
	it('tells the user chilled / frozen items need an expiry on every receive', () => {
		expect(expiryRequirementHint({ storage_type: 'CHILLED' })).toBe(
			'แช่เย็น / แช่แข็ง → ต้องกรอกวันหมดอายุทุกครั้งที่รับเข้า'
		);
		expect(expiryRequirementHint({ storage_type: 'FROZEN' })).toContain('ต้องกรอกวันหมดอายุ');
	});

	it('explains the shelf-life case, including the auto-fill', () => {
		const hint = expiryRequirementHint({ storage_type: 'DRY', shelf_life_days: 180 });
		expect(hint).toContain('180 วัน');
		expect(hint).toContain('ต้องกรอกวันหมดอายุ');
	});

	it('says an expiry is optional otherwise', () => {
		expect(expiryRequirementHint({ storage_type: 'DRY' })).toContain('ไม่บังคับ');
		expect(expiryRequirementHint({})).toContain('ไม่บังคับ');
	});
});

describe('mergeCatalogGenerations — requiresExpiry', () => {
	it('derives requiresExpiry for item masters instead of hardcoding false', () => {
		const merged = mergeCatalogGenerations(
			[],
			[
				{ _id: 'item_master:milk', name: 'นม', base_unit: 'l', storage_type: 'CHILLED' },
				{ _id: 'item_master:rice', name: 'ข้าว', base_unit: 'kg', storage_type: 'DRY' },
				{ _id: 'item_master:can', name: 'กระป๋อง', base_unit: 'can', shelf_life_days: 365 }
			]
		);
		expect(Object.fromEntries(merged.map((m) => [m._id, m.requiresExpiry]))).toEqual({
			'item_master:milk': true,
			'item_master:rice': false,
			'item_master:can': true
		});
	});

	it('keeps requiresExpiry true for a legacy perishable supply item', () => {
		const merged = mergeCatalogGenerations(
			[
				{ _id: 'item:egg', name: 'ไข่', unit: 'ฟอง', perishable: true },
				{ _id: 'item:rice', name: 'ข้าวสาร', unit: 'kg' }
			],
			[]
		);
		expect(merged.map((m) => m.requiresExpiry)).toEqual([true, false]);
	});
});
