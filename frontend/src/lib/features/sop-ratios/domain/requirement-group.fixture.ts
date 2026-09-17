import type { RequirementGroup } from './requirement-group';

export const DEFAULT_REQUIREMENT_GROUPS: RequirementGroup[] = [
	{
		_id: 'requirement_group:FOOD_ENERGY',
		type: 'requirement_group',
		schema_v: 1,
		name: 'กลุ่มแป้งและพลังงานหลัก',
		standard_uom: 'kcal',
		status: 'active',
		item_maps: [
			{
				item_id: 'item_master:rice',
				base_uom: 'kg',
				conversion_factor: 3600,
				share_percent: 100
			}
		],
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system'
	},
	{
		_id: 'requirement_group:FOOD_PROTEIN',
		type: 'requirement_group',
		schema_v: 1,
		name: 'กลุ่มโปรตีนและเนื้อสัตว์',
		standard_uom: 'gram',
		status: 'active',
		item_maps: [
			{
				item_id: 'item_master:egg',
				base_uom: 'piece',
				conversion_factor: 6.3,
				share_percent: 50
			},
			{
				item_id: 'item_master:canned-fish',
				base_uom: 'can',
				conversion_factor: 17,
				share_percent: 50
			}
		],
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system'
	},
	{
		_id: 'requirement_group:FOOD_PROTEIN_HALAL',
		type: 'requirement_group',
		schema_v: 1,
		name: 'กลุ่มโปรตีนและเนื้อสัตว์ (ฮาลาล)',
		standard_uom: 'gram',
		status: 'active',
		item_maps: [
			{
				item_id: 'item_master:chicken',
				base_uom: 'kg',
				conversion_factor: 200,
				share_percent: 70
			},
			{
				item_id: 'item_master:egg',
				base_uom: 'piece',
				conversion_factor: 6.3,
				share_percent: 30
			}
		],
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system'
	},
	{
		_id: 'requirement_group:FOOD_FAT',
		type: 'requirement_group',
		schema_v: 1,
		name: 'กลุ่มน้ำมันและไขมัน',
		standard_uom: 'gram',
		status: 'active',
		item_maps: [
			{
				item_id: 'item_master:oil',
				base_uom: 'bottle',
				conversion_factor: 900,
				share_percent: 100
			}
		],
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system'
	},
	{
		_id: 'requirement_group:DRINKING_WATER',
		type: 'requirement_group',
		schema_v: 1,
		name: 'กลุ่มน้ำดื่มสะอาด',
		standard_uom: 'liter',
		status: 'active',
		item_maps: [
			{
				item_id: 'item_master:water-600ml',
				base_uom: 'bottle',
				conversion_factor: 0.6,
				share_percent: 70
			},
			{
				item_id: 'item_master:water-5l',
				base_uom: 'bottle',
				conversion_factor: 5,
				share_percent: 30
			}
		],
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system'
	}
];
