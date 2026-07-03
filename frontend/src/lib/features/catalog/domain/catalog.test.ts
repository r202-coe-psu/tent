// Ai เขียน

import { describe, it, expect } from 'vitest';
import {
	createItemMaster,
	isItemMaster,
	itemMasterInputSchema,
	createItemCategory,
	isItemCategory,
	itemCategoryInputSchema
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
			distribution_type: 'consumable' as const,
			target_audience_type: 'all' as const,
			target_restrictions: {
				genders: [],
				vulnerable_groups: [],
				diet_religions: []
			},
			is_default: false
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
			distribution_type: 'consumable' as const,
			target_audience_type: 'all' as const,
			target_restrictions: {
				genders: [],
				vulnerable_groups: [],
				diet_religions: []
			},
			is_default: true
		};

		const doc = createItemMaster(input, ctx);
		expect(doc._id).toMatch(/^item_master:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(doc.type).toBe('item_master');
		expect(doc.name).toBe('ยาพาราเซตามอล');
		expect(isItemMaster(doc)).toBe(true);
	});

	it('should validate valid item category input', () => {
		const input = {
			name: 'อาหารแห้ง',
			is_default: true
		};
		const parsed = itemCategoryInputSchema.parse(input);
		expect(parsed.name).toBe('อาหารแห้ง');
		expect(parsed.is_default).toBe(true);
	});

	it('should create item category doc with item_category: prefix', () => {
		const input = {
			name: 'เครื่องมือแพทย์',
			is_default: false
		};
		const doc = createItemCategory(input, ctx);
		expect(doc._id).toMatch(/^item_category:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(doc.type).toBe('item_category');
		expect(doc.name).toBe('เครื่องมือแพทย์');
		expect(isItemCategory(doc)).toBe(true);
	});
});

