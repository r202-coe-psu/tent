import { describe, it, expect } from 'vitest';
import { buildFoodSphereTable, resolveItemPolicy } from './food-sphere-table';
import { DEFAULT_FOOD_SPHERE_STANDARDS } from './food-sphere.fixture';
import { DEFAULT_REQUIREMENT_GROUPS } from './requirement-group.fixture';
import { DEFAULT_REPLENISHMENT_POLICIES } from './replenishment-policy.fixture';
import type { ReplenishmentPolicy } from './replenishment-policy';
import type { RequirementGroup } from './requirement-group';

describe('Food Sphere Table Domain Logic', () => {
	const mockItemMasters = [
		{
			_id: 'item_master:rice',
			name: 'ข้าวสารหอมมะลิ',
			category: 'food',
			sku: 'SKU-RICE-01',
			base_unit: 'kg'
		},
		{
			_id: 'item_master:egg',
			name: 'ไข่ไก่สด เบอร์ 2',
			category: 'food',
			sku: 'SKU-EGG-02',
			base_unit: 'piece'
		},
		{
			_id: 'item_master:blanket',
			name: 'ผ้าห่มกันหนาว',
			category: 'bedding',
			sku: 'SKU-BLANKET-01',
			base_unit: 'piece'
		}
	];

	describe('resolveItemPolicy', () => {
		it('prioritizes ITEM scope over REQUIREMENT_GROUP and GLOBAL', () => {
			const itemPolicy: ReplenishmentPolicy = {
				_id: 'replenishment_policy:ITEM:item_master:rice',
				type: 'replenishment_policy',
				schema_v: 1,
				scope_type: 'ITEM',
				target_id: 'item_master:rice',
				lead_time_days: 1,
				review_period_days: 1,
				safety_days: 1,
				min_doc_days: 1,
				max_doc_days: 10,
				source: 'SPHERE_BASELINE',
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			const policies = [...DEFAULT_REPLENISHMENT_POLICIES, itemPolicy];
			const resolved = resolveItemPolicy('item_master:rice', 'FOOD_ENERGY', policies);
			expect(resolved?._id).toBe('replenishment_policy:ITEM:item_master:rice');
		});

		it('falls back to REQUIREMENT_GROUP if no ITEM policy exists', () => {
			const resolved = resolveItemPolicy(
				'item_master:rice',
				'FOOD_ENERGY',
				DEFAULT_REPLENISHMENT_POLICIES
			);
			expect(resolved?._id).toBe('replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY');
		});

		it('falls back to GLOBAL policy if neither ITEM nor GROUP exists', () => {
			const globalPolicy: ReplenishmentPolicy = {
				_id: 'replenishment_policy:GLOBAL:ALL',
				type: 'replenishment_policy',
				schema_v: 1,
				scope_type: 'GLOBAL',
				target_id: 'ALL',
				lead_time_days: 5,
				review_period_days: 5,
				safety_days: 5,
				min_doc_days: 5,
				max_doc_days: 60,
				source: 'SPHERE_BASELINE',
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			const resolved = resolveItemPolicy('item_master:unknown', 'UNKNOWN_GROUP', [globalPolicy]);
			expect(resolved?._id).toBe('replenishment_policy:GLOBAL:ALL');
		});

		it('returns null if no matching policy exists', () => {
			const resolved = resolveItemPolicy('item_master:unknown', 'UNKNOWN_GROUP', []);
			expect(resolved).toBeNull();
		});

		it('ignores inactive policies when resolving', () => {
			const inactiveItemPolicy: ReplenishmentPolicy = {
				_id: 'replenishment_policy:ITEM:item_master:rice',
				type: 'replenishment_policy',
				schema_v: 1,
				scope_type: 'ITEM',
				target_id: 'item_master:rice',
				lead_time_days: 1,
				review_period_days: 1,
				safety_days: 1,
				min_doc_days: 1,
				max_doc_days: 10,
				status: 'inactive',
				source: 'SPHERE_BASELINE',
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			const policies = [...DEFAULT_REPLENISHMENT_POLICIES, inactiveItemPolicy];
			// Because ITEM policy is inactive, it should fall back to active REQUIREMENT_GROUP
			const resolved = resolveItemPolicy('item_master:rice', 'FOOD_ENERGY', policies);
			expect(resolved?._id).toBe('replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY');
		});
	});

	describe('buildFoodSphereTable', () => {
		it('builds grouped items and computes demand and DoC correctly', () => {
			// Headcount: 10 people
			// FOOD_ENERGY baseline for ALL = 2100 kcal -> totalGroupDemand = 21000 kcal
			// Rice: conversionFactor = 3600 kcal/kg, share = 100% -> itemDemand = 21000 / 3600 = 5.8333... kg/day
			// Stock: 35 kg -> DoC = 35 / 5.8333 = 6.0 days
			// Policy for FOOD_ENERGY: lead=3, review=4, safety=3 -> reorderDays=10, min=3, max=45
			// DoC=6.0 is > 3 and <= reorderDays(10) -> WARNING_REORDER
			const balance = new Map<string, string>([
				['item_master:rice', '35'],
				['item_master:egg', '0'],
				['item_master:blanket', '20']
			]);

			const result = buildFoodSphereTable({
				itemMasters: mockItemMasters,
				balance,
				requirementGroups: DEFAULT_REQUIREMENT_GROUPS,
				standards: DEFAULT_FOOD_SPHERE_STANDARDS,
				policies: DEFAULT_REPLENISHMENT_POLICIES,
				headcounts: { ALL: 10 }
			});

			// Group 1: FOOD_ENERGY
			const energyGroup = result.groups.find((g) => g.id === 'FOOD_ENERGY');
			expect(energyGroup).toBeDefined();
			expect(energyGroup?.totalGroupDemand).toBe(21000);
			expect(energyGroup?.items.length).toBe(1);

			const rice = energyGroup?.items[0];
			expect(rice?.name).toBe('ข้าวสารหอมมะลิ');
			expect(rice?.itemDailyDemand).toBeCloseTo(5.8333, 3);
			expect(rice?.docDays).toBeCloseTo(6.0, 1);
			expect(rice?.status).toBe('WARNING_REORDER');

			// Group 2: FOOD_PROTEIN
			// FOOD_PROTEIN baseline for ALL = 53 g -> totalGroupDemand = 530 g
			// Egg: conversionFactor = 6.3 g/piece, share = 100% -> itemDemand = 530 / 6.3 = 84.127 pieces/day
			// Stock = 0 -> DoC = 0 days <= lead_time (2) -> CRITICAL
			const proteinGroup = result.groups.find((g) => g.id === 'FOOD_PROTEIN');
			expect(proteinGroup).toBeDefined();
			expect(proteinGroup?.totalGroupDemand).toBe(530);
			const egg = proteinGroup?.items[0];
			expect(egg?.name).toBe('ไข่ไก่สด เบอร์ 2');
			expect(egg?.itemDailyDemand).toBeCloseTo(84.127, 2);
			expect(egg?.docDays).toBe(0);
			expect(egg?.status).toBe('CRITICAL');

			// General group for unmapped items (blanket)
			const generalGroup = result.groups.find((g) => g.id === 'GENERAL');
			expect(generalGroup).toBeDefined();
			expect(generalGroup?.items.length).toBe(1);
			const blanket = generalGroup?.items[0];
			expect(blanket?.name).toBe('ผ้าห่มกันหนาว');
			expect(blanket?.itemDailyDemand).toBe(0);
			expect(blanket?.docDays).toBeNull();
			expect(blanket?.status).toBe('UNCONFIGURED');

			// Summary stats
			expect(result.summary.totalItems).toBe(3);
			expect(result.summary.criticalCount).toBe(1);
			expect(result.summary.warningCount).toBe(1);
			expect(result.summary.unconfiguredCount).toBe(1);
			expect(result.summary.adequateCount).toBe(0);
			expect(result.summary.overstockCount).toBe(0);
		});

		it('handles items with partial share % correctly', () => {
			const customGroup: RequirementGroup = {
				_id: 'requirement_group:FOOD_PROTEIN',
				type: 'requirement_group',
				schema_v: 1,
				name: 'โปรตีน',
				standard_uom: 'gram',
				item_maps: [
					{
						item_id: 'item_master:egg',
						base_uom: 'piece',
						conversion_factor: 6.3,
						share_percent: 30
					},
					{
						item_id: 'item_master:chicken',
						base_uom: 'kg',
						conversion_factor: 250,
						share_percent: 70
					}
				],
				source: 'SPHERE_BASELINE',
				created_at: '2026-07-16T00:00:00.000Z',
				updated_at: '2026-07-16T00:00:00.000Z',
				created_by: 'system'
			};

			const customItemMasters = [
				...mockItemMasters,
				{
					_id: 'item_master:chicken',
					name: 'เนื้อไก่สด',
					category: 'food',
					sku: 'SKU-CHICKEN-01',
					base_unit: 'kg'
				}
			];

			// 12 people, protein demand = 53 g/person -> total = 636 g
			// Egg: 30% of 636 = 190.8 g / 6.3 = 30.2857 eggs/day
			// Chicken: 70% of 636 = 445.2 g / 250 = 1.7808 kg/day
			const result = buildFoodSphereTable({
				itemMasters: customItemMasters,
				balance: new Map([
					['item_master:egg', '0'],
					['item_master:chicken', '150']
				]),
				requirementGroups: [customGroup],
				standards: DEFAULT_FOOD_SPHERE_STANDARDS,
				policies: DEFAULT_REPLENISHMENT_POLICIES,
				headcounts: { ALL: 12 }
			});

			const group = result.groups.find((g) => g.id === 'FOOD_PROTEIN');
			expect(group?.items.length).toBe(2);

			const egg = group?.items.find((i) => i.itemId === 'item_master:egg');
			expect(egg?.itemDailyDemand).toBeCloseTo(30.2857, 3);
			expect(egg?.status).toBe('CRITICAL');

			const chicken = group?.items.find((i) => i.itemId === 'item_master:chicken');
			expect(chicken?.itemDailyDemand).toBeCloseTo(1.7808, 3);
			// Stock: 150 kg -> DoC = 150 / 1.7808 = 84.23 days (> max_doc_days 20) -> OVERSTOCK
			expect(chicken?.status).toBe('OVERSTOCK');
		});

		it('never produces NaN or Infinity even with 0 headcounts or 0 stock', () => {
			const result = buildFoodSphereTable({
				itemMasters: mockItemMasters,
				balance: new Map(),
				requirementGroups: DEFAULT_REQUIREMENT_GROUPS,
				standards: DEFAULT_FOOD_SPHERE_STANDARDS,
				policies: DEFAULT_REPLENISHMENT_POLICIES,
				headcounts: {}
			});

			for (const group of result.groups) {
				for (const item of group.items) {
					expect(Number.isNaN(item.itemDailyDemand)).toBe(false);
					expect(Number.isFinite(item.itemDailyDemand)).toBe(true);
					if (item.docDays !== null) {
						expect(Number.isNaN(item.docDays)).toBe(false);
						expect(Number.isFinite(item.docDays)).toBe(true);
					}
					expect(item.status).toBe('UNCONFIGURED');
				}
			}
		});

		it('skips inactive requirement groups from generating table groups and daily demand', () => {
			const groupsWithInactive: RequirementGroup[] = DEFAULT_REQUIREMENT_GROUPS.map((g) => {
				if (g._id === 'requirement_group:FOOD_PROTEIN') {
					return { ...g, status: 'inactive' };
				}
				return g;
			});

			const result = buildFoodSphereTable({
				itemMasters: mockItemMasters,
				balance: new Map([['item_master:rice', '100']]),
				requirementGroups: groupsWithInactive,
				standards: DEFAULT_FOOD_SPHERE_STANDARDS,
				policies: DEFAULT_REPLENISHMENT_POLICIES,
				headcounts: { ALL: 10 }
			});

			// FOOD_PROTEIN should be skipped from active table groups
			expect(result.groups.some((g) => g.id === 'FOOD_PROTEIN')).toBe(false);
			expect(result.groups.some((g) => g.id === 'FOOD_ENERGY')).toBe(true);
		});
	});
});
