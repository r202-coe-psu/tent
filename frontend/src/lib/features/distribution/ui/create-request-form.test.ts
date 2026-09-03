import { describe, expect, it } from 'vitest';
import type { ItemMaster } from '$lib/features/catalog';
import {
	ALLOWED_BUFFER_PERCENTS,
	catalogDistributionTypeToSnapshot,
	createInitialFormItem,
	createInitialFormState,
	DEFAULT_BUFFER_PERCENT,
	isItemSelectedElsewhere,
	NFI_TEMPLATE_PRESETS,
	validateCreateRequestForm
} from './create-request-form';

const sampleItemMasters: ItemMaster[] = [
	{
		_id: 'item:water_bottle',
		type: 'item_master',
		name: 'น้ำดื่ม 600ml',
		base_unit: 'ขวด',
		conversions: [],
		distribution_type: 'recurring',
		type_class: 'CONSUMABLE',
		dietary: [],
		schema_v: 1,
		created_at: '2026-08-30T00:00:00.000Z',
		updated_at: '2026-08-30T00:00:00.000Z',
		created_by: 'admin'
	},
	{
		_id: 'item:emergency_kit',
		type: 'item_master',
		name: 'ชุดยังชีพฉุกเฉิน',
		base_unit: 'ชุด',
		conversions: [],
		distribution_type: 'one_time',
		type_class: 'DURABLE',
		dietary: [],
		schema_v: 1,
		created_at: '2026-08-30T00:00:00.000Z',
		updated_at: '2026-08-30T00:00:00.000Z',
		created_by: 'admin'
	}
];

describe('create-request-form helper (Phase 4B)', () => {
	describe('catalogDistributionTypeToSnapshot mapping', () => {
		it('maps Catalog recurring to Distribution snapshot consumable', () => {
			expect(catalogDistributionTypeToSnapshot('recurring')).toBe('consumable');
		});

		it('maps Catalog one_time to Distribution snapshot one_time', () => {
			expect(catalogDistributionTypeToSnapshot('one_time')).toBe('one_time');
		});

		it('defaults undefined to consumable', () => {
			expect(catalogDistributionTypeToSnapshot(undefined)).toBe('consumable');
		});
	});

	describe('Buffer and initial state constants', () => {
		it('supports every integer from 5 to 10 inclusive with default 10', () => {
			expect(ALLOWED_BUFFER_PERCENTS).toEqual([5, 6, 7, 8, 9, 10]);
			expect(DEFAULT_BUFFER_PERCENT).toBe(10);
		});

		it('creates initial form item with empty or specified default itemId', () => {
			const item1 = createInitialFormItem();
			expect(item1.id).toBeDefined();
			expect(item1.itemId).toBe('');
			expect(item1.requestedQty).toBe('');

			const item2 = createInitialFormItem('item:default');
			expect(item2.itemId).toBe('item:default');
		});

		it('creates initial form state with default buffer and 1 empty row', () => {
			const state = createInitialFormState();
			expect(state.purpose).toBe('');
			expect(state.note).toBe('');
			expect(state.bufferPercent).toBe(10);
			expect(state.items).toHaveLength(1);
			expect(state.items[0].itemId).toBe('');
			expect(state.items[0].requestedQty).toBe('');
		});
	});

	describe('item selection availability', () => {
		it('disables only selections made by other rows and derives availability from current rows', () => {
			const initialItems = [
				{ id: 'row-1', itemId: 'item:water_bottle', requestedQty: '1', targetQtySnapshot: '' },
				{ id: 'row-2', itemId: 'item:emergency_kit', requestedQty: '1', targetQtySnapshot: '' }
			];

			expect(isItemSelectedElsewhere(initialItems, 0, 'item:water_bottle')).toBe(false);
			expect(isItemSelectedElsewhere(initialItems, 1, 'item:water_bottle')).toBe(true);
			expect(
				isItemSelectedElsewhere(
					[{ ...initialItems[0] }, { ...initialItems[1], itemId: 'item:water_bottle' }],
					1,
					'item:water_bottle'
				)
			).toBe(false);

			const changedItems = [{ ...initialItems[0], itemId: 'item:new' }, initialItems[1]];
			expect(isItemSelectedElsewhere(changedItems, 1, 'item:water_bottle')).toBe(false);
			expect(isItemSelectedElsewhere(changedItems, 1, 'item:new')).toBe(true);
			expect(isItemSelectedElsewhere([changedItems[1]], 0, 'item:new')).toBe(false);
		});
	});

	describe('validateCreateRequestForm', () => {
		it('validates a correct form and returns a normalized DistributionRequestInput payload', () => {
			const formState = {
				purpose: 'แจกจ่ายน้ำดื่มและชุดยังชีพประจำวัน',
				note: 'ส่งมอบที่เต็นท์โซน C',
				bufferPercent: 10,
				items: [
					{
						id: 'row-1',
						itemId: 'item:water_bottle',
						requestedQty: '110',
						targetQtySnapshot: ''
					},
					{
						id: 'row-2',
						itemId: 'item:emergency_kit',
						requestedQty: '100',
						targetQtySnapshot: ''
					}
				]
			};

			const result = validateCreateRequestForm(formState, 100, sampleItemMasters);
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual({});
			expect(result.payload).toEqual({
				purpose: 'แจกจ่ายน้ำดื่มและชุดยังชีพประจำวัน',
				note: 'ส่งมอบที่เต็นท์โซน C',
				active_headcount_snapshot: '100',
				buffer_percent: 10,
				items: [
					{
						item_id: 'item:water_bottle',
						requested_qty: '110',
						unit: 'ขวด',
						distribution_type_snapshot: 'consumable',
						target_qty_snapshot: '110'
					},
					{
						item_id: 'item:emergency_kit',
						requested_qty: '100',
						unit: 'ชุด',
						distribution_type_snapshot: 'one_time',
						target_qty_snapshot: '110'
					}
				]
			});
		});

		it('supports all buffer values 5, 6, 7, 8, 9, 10', () => {
			for (const buffer of [5, 6, 7, 8, 9, 10]) {
				const formState = {
					purpose: 'Test buffer',
					note: '',
					bufferPercent: buffer,
					items: [
						{
							id: 'row-1',
							itemId: 'item:water_bottle',
							requestedQty: '50',
							targetQtySnapshot: ''
						}
					]
				};
				const result = validateCreateRequestForm(formState, 100, sampleItemMasters);
				expect(result.valid).toBe(true);
				expect(result.payload?.buffer_percent).toBe(buffer);
			}
		});

		it('rejects invalid buffer percentage', () => {
			const formState = {
				purpose: 'Invalid buffer',
				note: '',
				bufferPercent: 4,
				items: [
					{
						id: 'row-1',
						itemId: 'item:water_bottle',
						requestedQty: '50',
						targetQtySnapshot: ''
					}
				]
			};
			const result = validateCreateRequestForm(formState, 100, sampleItemMasters);
			expect(result.valid).toBe(false);
			expect(result.errors.bufferPercent).toBeDefined();
		});

		it('rejects empty or blank purpose', () => {
			const formState = {
				purpose: '   ',
				note: '',
				bufferPercent: 10,
				items: [
					{
						id: 'row-1',
						itemId: 'item:water_bottle',
						requestedQty: '50',
						targetQtySnapshot: ''
					}
				]
			};
			const result = validateCreateRequestForm(formState, 100, sampleItemMasters);
			expect(result.valid).toBe(false);
			expect(result.errors.purpose).toBeDefined();
		});

		it('rejects when active headcount is null, undefined, or invalid', () => {
			const formState = {
				purpose: 'Test headcount',
				note: '',
				bufferPercent: 10,
				items: [
					{
						id: 'row-1',
						itemId: 'item:water_bottle',
						requestedQty: '50',
						targetQtySnapshot: ''
					}
				]
			};
			expect(validateCreateRequestForm(formState, null, sampleItemMasters).valid).toBe(false);
			expect(validateCreateRequestForm(formState, undefined, sampleItemMasters).valid).toBe(false);
			expect(validateCreateRequestForm(formState, -5, sampleItemMasters).valid).toBe(false);
			expect(validateCreateRequestForm(formState, 12.5, sampleItemMasters).valid).toBe(false);
		});

		it('rejects unknown item ID not in Catalog', () => {
			const formState = {
				purpose: 'Unknown item test',
				note: '',
				bufferPercent: 10,
				items: [
					{
						id: 'row-1',
						itemId: 'item:nonexistent',
						requestedQty: '10',
						targetQtySnapshot: ''
					}
				]
			};
			const result = validateCreateRequestForm(formState, 100, sampleItemMasters);
			expect(result.valid).toBe(false);
			expect(result.errors.item_0_id).toBeDefined();
		});

		it('rejects zero or negative quantity', () => {
			const formState = {
				purpose: 'Zero qty test',
				note: '',
				bufferPercent: 10,
				items: [
					{
						id: 'row-1',
						itemId: 'item:water_bottle',
						requestedQty: '0',
						targetQtySnapshot: ''
					}
				]
			};
			const result = validateCreateRequestForm(formState, 100, sampleItemMasters);
			expect(result.valid).toBe(false);
			expect(result.errors.item_0_qty).toBeDefined();
		});

		it('rejects duplicate item IDs on the second and later rows', () => {
			const formState = {
				purpose: 'Duplicate rows rejected',
				note: '',
				bufferPercent: 10,
				items: [
					{
						id: 'row-1',
						itemId: 'item:water_bottle',
						requestedQty: '50',
						targetQtySnapshot: ''
					},
					{
						id: 'row-2',
						itemId: 'item:water_bottle',
						requestedQty: '60',
						targetQtySnapshot: ''
					},
					{
						id: 'row-3',
						itemId: 'item:water_bottle',
						requestedQty: '70',
						targetQtySnapshot: ''
					}
				]
			};
			const result = validateCreateRequestForm(formState, 100, sampleItemMasters);
			expect(result.valid).toBe(false);
			expect(result.errors.item_0_id).toBeUndefined();
			expect(result.errors.item_1_id).toBe('ไม่สามารถเลือกสิ่งของซ้ำกันในรายการเดียวกันได้');
			expect(result.errors.item_2_id).toBe('ไม่สามารถเลือกสิ่งของซ้ำกันในรายการเดียวกันได้');
		});

		it('keeps missing and unknown-item errors distinct from duplicate errors', () => {
			const emptyRows = validateCreateRequestForm(
				{
					purpose: 'Missing rows',
					note: '',
					bufferPercent: 10,
					items: [
						{ id: 'row-1', itemId: '', requestedQty: '1', targetQtySnapshot: '' },
						{ id: 'row-2', itemId: '', requestedQty: '1', targetQtySnapshot: '' }
					]
				},
				100,
				sampleItemMasters
			);
			expect(emptyRows.errors.item_0_id).toBe('กรุณาเลือกสิ่งของ');
			expect(emptyRows.errors.item_1_id).toBe('กรุณาเลือกสิ่งของ');

			const unknownItem = validateCreateRequestForm(
				{
					purpose: 'Unknown item',
					note: '',
					bufferPercent: 10,
					items: [
						{ id: 'row-1', itemId: 'item:water_bottle', requestedQty: '1', targetQtySnapshot: '' },
						{ id: 'row-2', itemId: 'item:missing', requestedQty: '1', targetQtySnapshot: '' }
					]
				},
				100,
				sampleItemMasters
			);
			expect(unknownItem.errors.item_1_id).toBe('ไม่พบข้อมูลสิ่งของใน Catalog');
		});

		it('rejects duplicates independently of decimal quantity parsing', () => {
			const result = validateCreateRequestForm(
				{
					purpose: 'Duplicate decimal rows',
					note: '',
					bufferPercent: 10,
					items: [
						{
							id: 'row-1',
							itemId: 'item:water_bottle',
							requestedQty: '0.1',
							targetQtySnapshot: ''
						},
						{ id: 'row-2', itemId: 'item:water_bottle', requestedQty: '0.2', targetQtySnapshot: '' }
					]
				},
				100,
				sampleItemMasters
			);

			expect(result.valid).toBe(false);
			expect(result.errors.item_1_id).toBe('ไม่สามารถเลือกสิ่งของซ้ำกันในรายการเดียวกันได้');
		});
	});

	describe('NFI Template Presets', () => {
		it('defines UI-only template presets with all marked isAvailable: false', () => {
			expect(NFI_TEMPLATE_PRESETS.length).toBeGreaterThan(0);
			for (const preset of NFI_TEMPLATE_PRESETS) {
				expect(preset.isAvailable).toBe(false);
				expect(preset.unavailableReason).toBeDefined();
			}
		});
	});
});
