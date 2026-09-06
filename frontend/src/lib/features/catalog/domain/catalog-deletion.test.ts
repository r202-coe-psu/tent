import { describe, it, expect } from 'vitest';
import { evaluateCategoryDeletion, type CategoryUsageDetails } from './catalog-deletion';

describe('evaluateCategoryDeletion', () => {
	const baseUsage: CategoryUsageDetails = {
		categoryId: 'item_category:test1',
		categoryName: 'เครื่องดื่ม',
		isOverride: false,
		shelterCode: null,
		centralItemMasters: [],
		shelterUsages: [],
		totalItemCount: 0,
		totalShelterCount: 0
	};

	describe('Central Scope (System Management)', () => {
		it('should decide hard_delete when category is completely unused', () => {
			const decision = evaluateCategoryDeletion(baseUsage, 'central');
			expect(decision.action).toBe('hard_delete');
			expect(decision.canHardDelete).toBe(true);
		});

		it('should decide deactivate when category is used by central item masters', () => {
			const usage: CategoryUsageDetails = {
				...baseUsage,
				centralItemMasters: ['น้ำดื่ม', 'นมจืด'],
				totalItemCount: 2
			};
			const decision = evaluateCategoryDeletion(usage, 'central');
			expect(decision.action).toBe('deactivate');
			expect(decision.canHardDelete).toBe(false);
			expect(decision.reason).toContain('มีสินค้าส่วนกลางใช้งานอยู่ 2 รายการ');
		});

		it('should decide deactivate when category is used by a shelter item master', () => {
			const usage: CategoryUsageDetails = {
				...baseUsage,
				shelterUsages: [
					{
						shelterCode: 'SH001',
						shelterName: 'ศูนย์พักพิงเทศบาล',
						itemMasters: ['น้ำแร่'],
						hasOverride: false
					}
				],
				totalItemCount: 1,
				totalShelterCount: 1
			};
			const decision = evaluateCategoryDeletion(usage, 'central');
			expect(decision.action).toBe('deactivate');
			expect(decision.canHardDelete).toBe(false);
			expect(decision.reason).toContain('มีศูนย์พักพิงใช้งานอยู่ 1 ศูนย์');
		});

		it('should decide deactivate when a shelter has an override of this category', () => {
			const usage: CategoryUsageDetails = {
				...baseUsage,
				shelterUsages: [
					{
						shelterCode: 'SH002',
						shelterName: 'ศูนย์พักพิงวัดใหญ่',
						itemMasters: [],
						hasOverride: true
					}
				],
				totalItemCount: 0,
				totalShelterCount: 1
			};
			const decision = evaluateCategoryDeletion(usage, 'central');
			expect(decision.action).toBe('deactivate');
			expect(decision.canHardDelete).toBe(false);
			expect(decision.reason).toContain('มีศูนย์พักพิงปรับแต่ง (Override) อยู่ 1 ศูนย์');
		});
	});

	describe('Shelter Scope (Back-office)', () => {
		it('should decide reset when document is an override', () => {
			const usage: CategoryUsageDetails = {
				...baseUsage,
				isOverride: true,
				shelterCode: 'SH001',
				totalItemCount: 3
			};
			const decision = evaluateCategoryDeletion(usage, 'shelter');
			expect(decision.action).toBe('reset');
			expect(decision.canHardDelete).toBe(false);
			expect(decision.reason).toContain('คืนค่ากลับเป็นค่ามาตรฐานส่วนกลาง');
		});

		it('should decide deactivate when local custom category has item masters', () => {
			const usage: CategoryUsageDetails = {
				...baseUsage,
				isOverride: false,
				shelterCode: 'SH001',
				totalItemCount: 2
			};
			const decision = evaluateCategoryDeletion(usage, 'shelter');
			expect(decision.action).toBe('deactivate');
			expect(decision.canHardDelete).toBe(false);
		});

		it('should decide hard_delete when local custom category has no item masters', () => {
			const usage: CategoryUsageDetails = {
				...baseUsage,
				isOverride: false,
				shelterCode: 'SH001',
				totalItemCount: 0
			};
			const decision = evaluateCategoryDeletion(usage, 'shelter');
			expect(decision.action).toBe('hard_delete');
			expect(decision.canHardDelete).toBe(true);
		});
	});
});
