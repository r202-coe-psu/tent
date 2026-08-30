import { z } from 'zod';
import type { CatalogDoc } from '$lib/db/model';
import { foodSphereSourceSchema, type FoodSphereSource } from './food-sphere';

export const STANDARD_UOM_OPTIONS = [
	{ value: 'kcal', label: 'กิโลแคลอรี' },
	{ value: 'gram', label: 'กรัม' },
	{ value: 'mg', label: 'มิลลิกรัม' },
	{ value: 'mcg', label: 'ไมโครกรัม' },
	{ value: 'litre', label: 'ลิตร' },
	{ value: 'ml', label: 'มิลลิลิตร' },
	{ value: 'piece', label: 'ชิ้น' }
] as const;

export const itemMapSchema = z.object({
	item_id: z.string().min(1, 'กรุณาเลือกสิ่งของ'),
	base_uom: z.string().min(1, 'กรุณาระบุหน่วยนับพื้นฐาน'),
	conversion_factor: z.coerce.number().positive('ตัวคูณแปลงค่าต้องมากกว่า 0'),
	share_percent: z.coerce.number().min(0).max(100).optional()
});
export type ItemMap = z.infer<typeof itemMapSchema>;

export interface RequirementGroup extends CatalogDoc {
	type: 'requirement_group';
	schema_v: 1;
	name: string;
	standard_uom: string;
	status?: 'active' | 'inactive';
	item_maps?: ItemMap[];
	source: FoodSphereSource;
	shelter_code?: string;
}

export const requirementGroupInputSchema = z.object({
	name: z.string().trim().min(1, 'กรุณาระบุชื่อกลุ่มความต้องการ'),
	standard_uom: z.string().trim().min(1, 'กรุณาระบุหน่วยนับมาตรฐาน'),
	status: z.enum(['active', 'inactive']).optional().default('active'),
	item_maps: z.array(itemMapSchema).optional(),
	source: foodSphereSourceSchema.default('SPHERE_BASELINE'),
	shelter_code: z.string().optional()
});
export type RequirementGroupInput = z.infer<typeof requirementGroupInputSchema>;

export function isRequirementGroup(doc: unknown): doc is RequirementGroup {
	if (!doc || typeof doc !== 'object') return false;
	const d = doc as Record<string, unknown>;
	return (
		d.type === 'requirement_group' &&
		typeof d.name === 'string' &&
		typeof d.standard_uom === 'string'
	);
}
