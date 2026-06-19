import { z } from 'zod';
import type { BaseDoc, Timestamp, AuthorContext } from '$lib/db/model';
import { makeDoc, now } from '$lib/db/model';

export const productionStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export type ProductionStatus = z.infer<typeof productionStatusSchema>;

export const mealPeriodSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealPeriod = z.infer<typeof mealPeriodSchema>;

export interface ProductionLog extends BaseDoc {
	type: 'production_log';
	menu: string;
	sub_note?: string;
	boxes: number;
	weight_kg: number;
	status: ProductionStatus;
	meal_period: MealPeriod;
	stoves_used: number;
	stoves_total: number;
	started_at: Timestamp;
	completed_at: Timestamp | null;
	estimated_minutes: number | null;
}

export type KitchenDoc = ProductionLog;

export const productionLogInputSchema = z.object({
	menu: z.string().trim().min(1, 'Menu is required'),
	sub_note: z.string().trim().optional(),
	boxes: z.coerce.number().int().positive(),
	weight_kg: z.coerce.number().positive(),
	status: productionStatusSchema.default('pending'),
	meal_period: mealPeriodSchema,
	stoves_used: z.coerce.number().int().min(0).default(0),
	stoves_total: z.coerce.number().int().positive().default(4),
	estimated_minutes: z.coerce.number().nullable().default(null)
});
export type ProductionLogInput = z.input<typeof productionLogInputSchema>;

export function createProductionLog(input: ProductionLogInput, ctx: AuthorContext): ProductionLog {
	const d = productionLogInputSchema.parse(input);
	return makeDoc(
		'production_log',
		1,
		{
			menu: d.menu,
			...(d.sub_note ? { sub_note: d.sub_note } : {}),
			boxes: d.boxes,
			weight_kg: d.weight_kg,
			status: d.status,
			meal_period: d.meal_period,
			stoves_used: d.stoves_used,
			stoves_total: d.stoves_total,
			estimated_minutes: d.estimated_minutes,
			started_at: now(),
			completed_at: d.status === 'completed' ? now() : null
		},
		ctx
	);
}

export const isProductionLog = (d: unknown): d is ProductionLog =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'production_log';

export const STATUS_CONFIG: Record<ProductionStatus, { label: string; className: string }> = {
	pending: { label: 'รอดำเนินการ', className: 'bg-yellow-50 text-yellow-700' },
	in_progress: { label: 'กำลังประกอบ', className: 'bg-blue-50 text-blue-700' },
	completed: { label: 'สำเร็จแล้ว', className: 'bg-green-50 text-green-700' },
	cancelled: { label: 'ยกเลิก', className: 'bg-red-50 text-red-600' }
};

export const MEAL_PERIOD_LABELS: Record<MealPeriod, string> = {
	breakfast: 'มื้อเช้า',
	lunch: 'มื้อกลางวัน',
	dinner: 'มื้อเย็น',
	snack: 'ของว่าง'
};

export function shortCode(log: ProductionLog): string {
	const part = log._id.split(':')[1] ?? log._id;
	return `PRD-${part.slice(-4).toUpperCase()}`;
}
