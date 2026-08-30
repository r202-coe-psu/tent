import { z } from 'zod';
import type { CatalogDoc } from '$lib/db/model';
import { foodSphereSourceSchema, type FoodSphereSource } from './food-sphere';

export const replenishmentScopeSchema = z.enum(['GLOBAL', 'REQUIREMENT_GROUP', 'ITEM']);
export type ReplenishmentScope = z.infer<typeof replenishmentScopeSchema>;

export const REPLENISHMENT_SCOPE_LABELS: Record<ReplenishmentScope, string> = {
	GLOBAL: 'ส่วนกลางทั้งหมด (GLOBAL)',
	REQUIREMENT_GROUP: 'กลุ่มสารอาหาร (REQUIREMENT_GROUP)',
	ITEM: 'รายสินค้า (ITEM)'
};

export interface ReplenishmentPolicy extends CatalogDoc {
	type: 'replenishment_policy';
	schema_v: 1;
	scope_type: ReplenishmentScope;
	target_id: string;
	lead_time_days: number;
	review_period_days: number;
	safety_days: number;
	min_doc_days: number;
	max_doc_days: number;
	status?: 'active' | 'inactive';
	source: FoodSphereSource;
	shelter_code?: string;
}

export const replenishmentPolicyInputSchema = z
	.object({
		scope_type: replenishmentScopeSchema,
		target_id: z.string().trim().min(1, 'กรุณาระบุเป้าหมายของนโยบาย'),
		lead_time_days: z.coerce.number().int().min(0, 'Lead time ต้องไม่ติดลบ'),
		review_period_days: z.coerce.number().int().min(0, 'Review period ต้องไม่ติดลบ'),
		safety_days: z.coerce.number().int().min(0, 'Safety days ต้องไม่ติดลบ'),
		min_doc_days: z.coerce.number().int().min(0, 'Min DoC ต้องไม่ติดลบ'),
		max_doc_days: z.coerce.number().int().min(0, 'Max DoC ต้องไม่ติดลบ'),
		status: z.enum(['active', 'inactive']).optional().default('active'),
		source: foodSphereSourceSchema.default('SPHERE_BASELINE'),
		shelter_code: z.string().optional()
	})
	.refine(
		(data) => {
			const standardReorder = data.lead_time_days + data.review_period_days + data.safety_days;
			return data.min_doc_days < standardReorder;
		},
		{
			message:
				'Min DoC Days ต้องน้อยกว่า Standard Reorder Days (Lead Time + Review Period + Safety Days)',
			path: ['min_doc_days']
		}
	)
	.refine((data) => data.min_doc_days < data.max_doc_days, {
		message: 'Min DoC Days ต้องน้อยกว่า Max DoC Days',
		path: ['max_doc_days']
	});

export type ReplenishmentPolicyInput = z.infer<typeof replenishmentPolicyInputSchema>;

export function isReplenishmentPolicy(doc: unknown): doc is ReplenishmentPolicy {
	if (!doc || typeof doc !== 'object') return false;
	const d = doc as Record<string, unknown>;
	return (
		d.type === 'replenishment_policy' &&
		typeof d.scope_type === 'string' &&
		typeof d.target_id === 'string' &&
		typeof d.lead_time_days === 'number'
	);
}
