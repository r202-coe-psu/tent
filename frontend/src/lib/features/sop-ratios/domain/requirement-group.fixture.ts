import type { RequirementGroup } from './requirement-group';

export const DEFAULT_REQUIREMENT_GROUPS: RequirementGroup[] = [
	{
		_id: 'requirement_group:FOOD_ENERGY',
		type: 'requirement_group',
		schema_v: 1,
		name: 'พลังงานอาหาร',
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
		name: 'โปรตีน',
		standard_uom: 'gram',
		status: 'active',
		item_maps: [
			{
				item_id: 'item_master:egg',
				base_uom: 'piece',
				conversion_factor: 6.3,
				share_percent: 100
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
		name: 'ไขมัน',
		standard_uom: 'gram',
		status: 'active',
		item_maps: [],
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system'
	}
];
