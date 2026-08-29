import type { ReplenishmentPolicy } from './replenishment-policy';

export const DEFAULT_REPLENISHMENT_POLICIES: ReplenishmentPolicy[] = [
	{
		_id: 'replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY',
		type: 'replenishment_policy',
		schema_v: 1,
		scope_type: 'REQUIREMENT_GROUP',
		target_id: 'FOOD_ENERGY',
		lead_time_days: 3,
		review_period_days: 4,
		safety_days: 3,
		min_doc_days: 3,
		max_doc_days: 45,
		status: 'active',
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system'
	},
	{
		_id: 'replenishment_policy:REQUIREMENT_GROUP:FOOD_PROTEIN',
		type: 'replenishment_policy',
		schema_v: 1,
		scope_type: 'REQUIREMENT_GROUP',
		target_id: 'FOOD_PROTEIN',
		lead_time_days: 2,
		review_period_days: 2,
		safety_days: 2,
		min_doc_days: 2,
		max_doc_days: 20,
		status: 'active',
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system'
	},
	{
		_id: 'replenishment_policy:REQUIREMENT_GROUP:FOOD_FAT',
		type: 'replenishment_policy',
		schema_v: 1,
		scope_type: 'REQUIREMENT_GROUP',
		target_id: 'FOOD_FAT',
		lead_time_days: 2,
		review_period_days: 3,
		safety_days: 2,
		min_doc_days: 2,
		max_doc_days: 30,
		status: 'active',
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system'
	}
];
