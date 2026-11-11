import { z } from 'zod';
import type { CatalogDoc } from '$lib/db/model';
import Decimal from 'decimal.js';
import {
	addQty,
	parseQty,
	qtyGt,
	qtyGte,
	qtyLte,
	qtyStrCoerceSchema,
	qtyStrCoerceNonNegativeSchema
} from '$lib/utils/qty';
import { foodSphereSourceSchema, type FoodSphereSource } from './food-sphere';
import { InvalidRatioQtyError, readRatioQty } from './qty-input';

export const STANDARD_UOM_OPTIONS = [
	{ value: 'kcal', label: 'กิโลแคลอรี' },
	{ value: 'gram', label: 'กรัม' },
	{ value: 'mg', label: 'มิลลิกรัม' },
	{ value: 'mcg', label: 'ไมโครกรัม' },
	{ value: 'liter', label: 'ลิตร' },
	{ value: 'ml', label: 'มิลลิลิตร' },
	{ value: 'piece', label: 'ชิ้น' }
] as const;

/**
 * Maps legacy requirement group UoM codes to canonical UoM codes in the catalog master.
 */
export const LEGACY_TO_CANONICAL_UOM: Record<string, string> = {
	gram: 'g',
	liter: 'l',
	litre: 'l',
	pcs: 'piece'
};

/**
 * Maps canonical UoM codes to requirement group standard UoM codes.
 */
export const CANONICAL_TO_LEGACY_UOM: Record<string, string> = {
	g: 'gram',
	l: 'liter',
	piece: 'piece'
};

/**
 * Normalizes a unit code to canonical master UoM code (e.g. 'gram' -> 'g', 'liter' -> 'l').
 */
export function toCanonicalUom(unit: string): string {
	return LEGACY_TO_CANONICAL_UOM[unit] ?? unit;
}

/**
 * Converts a unit code to its requirement group standard representation.
 */
export function toStandardReqGroupUom(unit: string): string {
	return CANONICAL_TO_LEGACY_UOM[unit] ?? unit;
}

export const itemMapSchema = z.object({
	item_id: z.string().min(1, 'กรุณาเลือกสิ่งของ'),
	base_uom: z.string().min(1, 'กรุณาระบุหน่วยนับพื้นฐาน'),
	conversion_factor: qtyStrCoerceSchema.refine((s) => qtyGt(s, 0), {
		message: 'ตัวคูณแปลงค่าต้องไม่น้อยกว่า 0.0001'
	}),
	share_percent: qtyStrCoerceSchema
		.refine((s) => qtyGte(s, 0), { message: 'ส่วนแบ่งต้องไม่ต่ำกว่า 0' })
		.refine((s) => qtyLte(s, 100), { message: 'ส่วนแบ่งต้องไม่เกิน 100' })
		.optional()
});
export const REQUIREMENT_GROUP_SCHEMA_VERSION = 2;

export type ItemMap = z.infer<typeof itemMapSchema>;

export interface RequirementGroup extends CatalogDoc {
	type: 'requirement_group';
	schema_v: 1 | 2;
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

/** Sum of share_percent across maps as qty_str (missing counts as 0). */
export function sumSharePercent(maps: Pick<ItemMap, 'share_percent'>[]): string {
	return maps.reduce((sum, m) => addQty(sum, m.share_percent ?? 0), '0');
}

/** True when the share sum is off 100 by more than 0.01. */
export function isShareSumOff(maps: Pick<ItemMap, 'share_percent'>[]): boolean {
	return parseQty(sumSharePercent(maps)).minus(100).abs().gt(new Decimal('0.01'));
}

/** Read-side normalizer: validate and round legacy quantities; status defaults to active. */
export function normalizeRequirementGroup(doc: RequirementGroup): RequirementGroup {
	const status = doc.status ?? 'active';
	if (doc.item_maps === undefined) return { ...doc, status };
	if (!Array.isArray(doc.item_maps)) throw new InvalidRatioQtyError(doc._id, 'item_maps');
	return {
		...doc,
		status,
		item_maps: doc.item_maps.map((m, i) => {
			if (!m || typeof m !== 'object') throw new InvalidRatioQtyError(doc._id, `item_maps[${i}]`);
			const conversion_factor = readRatioQty(
				doc._id,
				`item_maps[${i}].conversion_factor`,
				m.conversion_factor,
				qtyStrCoerceSchema
			);
			if (parseQty(m.conversion_factor).gt(0) && !qtyGt(conversion_factor, 0)) {
				throw new InvalidRatioQtyError(doc._id, `item_maps[${i}].conversion_factor`);
			}
			const share_percent =
				m.share_percent === undefined
					? undefined
					: readRatioQty(
							doc._id,
							`item_maps[${i}].share_percent`,
							m.share_percent,
							qtyStrCoerceNonNegativeSchema
						);
			if (share_percent !== undefined && qtyGt(share_percent, 100))
				throw new InvalidRatioQtyError(doc._id, `item_maps[${i}].share_percent`);
			return { ...m, conversion_factor, ...(share_percent === undefined ? {} : { share_percent }) };
		})
	};
}
