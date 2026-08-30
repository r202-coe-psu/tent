import { z } from 'zod';
import type { CatalogDoc } from '$lib/db/model';

export const targetSegmentSchema = z.enum([
	'ALL',
	'INFANT_0_6',
	'INFANT_6_23',
	'CHILD_2_5',
	'PREGNANT',
	'LACTATING',
	'ELDERLY'
]);
export type TargetSegment = z.infer<typeof targetSegmentSchema>;

export const TARGET_SEGMENT_LABELS: Record<TargetSegment, string> = {
	ALL: 'ทุกคน',
	INFANT_0_6: 'ทารก 0-6 เดือน',
	INFANT_6_23: 'ทารก 6-23 เดือน',
	CHILD_2_5: 'เด็กเล็ก 2-5 ขวบ',
	PREGNANT: 'สตรีมีครรภ์',
	LACTATING: 'สตรีให้นมบุตร',
	ELDERLY: 'ผู้สูงอายุ'
};

import { sourceSchema, SOURCE_LABELS, SOURCE_OPTIONS, type Source } from '$lib/utils/source';

export const foodSphereSourceSchema = sourceSchema;
export type FoodSphereSource = Source;

export { SOURCE_LABELS, SOURCE_OPTIONS };
export const FOOD_SPHERE_SOURCE_LABELS = SOURCE_LABELS;
export const FOOD_SPHERE_SOURCE_OPTIONS = SOURCE_OPTIONS;

export interface FoodSphereStandard extends CatalogDoc {
	type: 'food_sphere_standard';
	schema_v: 1;
	target_segment: TargetSegment;
	req_group_id: string; // e.g. "FOOD_ENERGY"
	daily_demand: number; // > 0
	standard_uom?: string;
	effective_date: string; // "YYYY-MM-DD"
	status?: 'active' | 'inactive';
	source: FoodSphereSource;
	shelter_code?: string;
}

export const foodSphereStandardInputSchema = z.object({
	target_segment: targetSegmentSchema,
	req_group_id: z.string().trim().min(1, 'กรุณาระบุกลุ่มความต้องการ'),
	daily_demand: z.coerce.number().positive('ปริมาณความต้องการต้องมากกว่า 0'),
	standard_uom: z.string().trim().optional(),
	effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD'),
	status: z.enum(['active', 'inactive']).optional().default('active'),
	source: foodSphereSourceSchema.default('SPHERE_BASELINE'),
	shelter_code: z.string().optional()
});
export type FoodSphereStandardInput = z.infer<typeof foodSphereStandardInputSchema>;

export function isFoodSphereStandard(doc: unknown): doc is FoodSphereStandard {
	if (!doc || typeof doc !== 'object') return false;
	const d = doc as Record<string, unknown>;
	return (
		d.type === 'food_sphere_standard' &&
		typeof d.target_segment === 'string' &&
		typeof d.req_group_id === 'string' &&
		typeof d.daily_demand === 'number'
	);
}
