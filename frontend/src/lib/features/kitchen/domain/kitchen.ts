import { z } from 'zod';
import type { BaseDoc, Timestamp, AuthorContext } from '$lib/db/model';
import { makeDoc } from '$lib/db/model';
import type { MealCalcSource } from './meal-calc';
import {
	persistQty,
	qtyGte,
	qtyStrCoerceNonNegativeSchema,
	qtyStrCoercePositiveSchema
} from '$lib/utils/qty';

// ---- enums ----

export const mealPeriodSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealPeriod = z.infer<typeof mealPeriodSchema>;

export const mealPlanStatusSchema = z.enum(['draft', 'confirmed']);
export type MealPlanStatus = z.infer<typeof mealPlanStatusSchema>;

export const MEAL_PERIOD_LABELS: Record<MealPeriod, string> = {
	breakfast: 'มื้อเช้า',
	lunch: 'มื้อกลางวัน',
	dinner: 'มื้อเย็น',
	snack: 'ของว่าง'
};

// ---- MealSession ------------------------------------------------------

export interface MealSessionHeadcount {
	halal: number; // เป้าหมายกลุ่มฮาลาล (มุสลิม)
	infant: number; // เป้าหมายกลุ่มเด็ก/ทารก
	soft_food: number; // เป้าหมายกลุ่มเปราะบาง/อาหารอ่อน
	regular: number; // เป้าหมายกลุ่มปกติ
	volunteer: number; // เป้าหมายกลุ่มอาสาสมัคร/เจ้าหน้าที่
	total: number; // เป้าหมายรวมทั้งหมด
}

export const mealSessionStatusSchema = z.enum(['active', 'completed', 'cancelled']);
export type MealSessionStatus = z.infer<typeof mealSessionStatusSchema>;

export interface MealSession extends BaseDoc {
	type: 'meal_session';
	schema_v: 1;
	name: string; // เช่น "มื้อเช้า 28 ส.ค. 2569"
	date: string; // YYYY-MM-DD
	meal: MealPeriod;
	status: MealSessionStatus;
	target_headcount: MealSessionHeadcount;
	notes?: string;
}

export const mealSessionInputSchema = z.object({
	name: z.string().trim().min(1, 'Name required'),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
	meal: mealPeriodSchema,
	status: mealSessionStatusSchema.default('active'),
	target_headcount: z.object({
		halal: z.number().int().min(0),
		infant: z.number().int().min(0),
		soft_food: z.number().int().min(0),
		regular: z.number().int().min(0),
		volunteer: z.number().int().min(0),
		total: z.number().int().min(0)
	}),
	notes: z.string().trim().optional()
});
export type MealSessionInput = z.input<typeof mealSessionInputSchema>;

export function createMealSession(input: MealSessionInput, ctx: AuthorContext): MealSession {
	const d = mealSessionInputSchema.parse(input);
	return makeDoc(
		'meal_session',
		1,
		{
			name: d.name,
			date: d.date,
			meal: d.meal,
			status: d.status,
			target_headcount: d.target_headcount,
			...(d.notes ? { notes: d.notes } : {})
		},
		ctx
	) as MealSession;
}

export const isMealSession = (d: unknown): d is MealSession =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'meal_session';

// ---- MealPlan ---------------------------------------------------------

export interface MealPlanHeadcount {
	total: number;
	halal: number;
	soft_food: number;
	infant: number;
}

export interface MealPlanRecipe {
	recipe_id: string;
	planned_qty: number;
	// Unit for BOM recipe items or custom ingredient stock drawdown.
	unit?: string;
}

export interface MealPlan extends BaseDoc {
	type: 'meal_plan';
	date: string;
	meal: MealPeriod;
	// Optional display name for custom or BOM menu.
	label?: string;
	headcount: MealPlanHeadcount;
	recipes: MealPlanRecipe[];
	status: MealPlanStatus;
	cooking_started_at?: Timestamp;
	override_reason?: string | null;
	calc_source?: MealCalcSource | null;
	meal_session_id?: string | null;
	target_tags?: string[];
	allocated_target?: number;
}

export const mealPlanInputSchema = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
	meal: mealPeriodSchema,
	label: z.string().trim().min(1).optional(),
	headcount: z
		.object({
			total: z.number().int().min(0),
			halal: z.number().int().min(0),
			soft_food: z.number().int().min(0),
			infant: z.number().int().min(0)
		})
		.refine((h) => h.halal <= h.total && h.soft_food <= h.total && h.infant <= h.total, {
			// Each sub-count is independently bounded by total headcount.
			message: 'Each sub-count (halal / soft_food / infant) cannot exceed total headcount'
		}),
	recipes: z
		.array(
			z.object({
				recipe_id: z.string().min(1),
				planned_qty: z.number().int().positive(),
				unit: z.string().trim().min(1).optional()
			})
		)
		.min(1, 'At least one recipe required'),
	status: mealPlanStatusSchema.default('draft'),
	override_reason: z.string().nullable().optional(),
	calc_source: z
		.object({
			sop_profile_id: z.string().min(1),
			sop_profile_version: z.number().int().positive(),
			headcount_as_of: z.string().datetime()
		})
		.nullable()
		.optional(),
	meal_session_id: z.string().nullable().optional(),
	target_tags: z.array(z.string()).optional(),
	allocated_target: z.number().int().min(0).optional()
});
export type MealPlanInput = z.input<typeof mealPlanInputSchema>;

// Creates a new meal plan document.
export function createMealPlan(input: MealPlanInput, ctx: AuthorContext): MealPlan {
	const d = mealPlanInputSchema.parse(input);
	return makeDoc(
		'meal_plan',
		2,
		{
			date: d.date,
			meal: d.meal,
			headcount: d.headcount,
			recipes: d.recipes,
			status: d.status,
			...(d.label != null ? { label: d.label } : {}),
			...(d.override_reason != null ? { override_reason: d.override_reason } : {}),
			...(d.calc_source != null ? { calc_source: d.calc_source } : {}),
			...(d.meal_session_id !== undefined ? { meal_session_id: d.meal_session_id } : {}),
			...(d.target_tags != null ? { target_tags: d.target_tags } : {}),
			...(d.allocated_target != null ? { allocated_target: d.allocated_target } : {})
		},
		ctx
	);
}

export const isMealPlan = (d: unknown): d is MealPlan =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'meal_plan';

// ---- KitchenRequisition (schema.md §2.6) — State Machine -------------

export type KitchenRequisitionStatus = 'pending' | 'approved' | 'rejected';

export interface KitchenRequisitionItem {
	item_id: string;
	qty_requested: string; // qty_str
	qty_issued: string; // qty_str
	unit: string;
}

export interface KitchenRequisition extends BaseDoc {
	type: 'kitchen_requisition';
	status: KitchenRequisitionStatus;
	meal_plan_id: string | null;
	meal_session_id?: string | null;
	items: KitchenRequisitionItem[];
	ledger_ids: string[];
	requested_at: Timestamp;
	issued_at?: Timestamp;
	approved_at?: Timestamp | null;
	approved_by?: string | null;
	reject_reason?: string | null;
}

export const kitchenRequisitionInputSchema = z.object({
	meal_plan_id: z.string().nullable().default(null),
	meal_session_id: z.string().nullable().optional(),
	items: z
		.array(
			z
				.object({
					item_id: z.string().min(1),
					qty_requested: qtyStrCoercePositiveSchema,
					qty_issued: qtyStrCoerceNonNegativeSchema,
					unit: z.string().trim().min(1)
				})
				// Disallow issuing more than requested.
				.refine((i) => qtyGte(i.qty_requested, i.qty_issued), {
					message: 'qty_issued cannot exceed qty_requested'
				})
		)
		.min(1, 'At least one item required')
});
export type KitchenRequisitionInput = z.input<typeof kitchenRequisitionInputSchema>;

export function createKitchenRequisition(
	input: KitchenRequisitionInput,
	ledgerIds: string[], // pre-generated by the pouch layer before the bulkDocs write
	ctx: AuthorContext
): KitchenRequisition {
	const d = kitchenRequisitionInputSchema.parse(input);
	const nowStr = new Date().toISOString();
	return makeDoc(
		'kitchen_requisition',
		3,
		{
			status: 'approved',
			meal_plan_id: d.meal_plan_id,
			...(d.meal_session_id !== undefined ? { meal_session_id: d.meal_session_id } : {}),
			items: d.items.map((i) => ({
				...i,
				qty_requested: persistQty(i.qty_requested),
				qty_issued: persistQty(i.qty_issued)
			})),
			ledger_ids: ledgerIds,
			requested_at: nowStr,
			issued_at: nowStr,
			approved_at: nowStr,
			approved_by: ctx.createdBy
		},
		ctx
	);
}

export const pendingRequisitionInputSchema = z.object({
	meal_plan_id: z.string().nullable().default(null),
	meal_session_id: z.string().nullable().optional(),
	items: z
		.array(
			z.object({
				item_id: z.string().min(1),
				qty_requested: qtyStrCoercePositiveSchema,
				qty_issued: qtyStrCoerceNonNegativeSchema.default('0'),
				unit: z.string().trim().min(1)
			})
		)
		.min(1, 'At least one item required')
});
export type PendingRequisitionInput = z.input<typeof pendingRequisitionInputSchema>;

export function createPendingRequisition(
	input: PendingRequisitionInput,
	ctx: AuthorContext
): KitchenRequisition {
	const d = pendingRequisitionInputSchema.parse(input);
	const nowStr = new Date().toISOString();
	return makeDoc(
		'kitchen_requisition',
		3,
		{
			status: 'pending',
			meal_plan_id: d.meal_plan_id,
			...(d.meal_session_id !== undefined ? { meal_session_id: d.meal_session_id } : {}),
			items: d.items.map((i) => ({
				...i,
				qty_requested: persistQty(i.qty_requested),
				qty_issued: persistQty(i.qty_issued)
			})),
			ledger_ids: [],
			requested_at: nowStr,
			issued_at: undefined,
			approved_at: null,
			approved_by: null,
			reject_reason: null
		},
		ctx
	);
}

/** Coerces legacy kitchen_requisition documents without status to approved. */
export const isKitchenRequisition = (d: unknown): d is KitchenRequisition => {
	if (!d || typeof d !== 'object' || (d as { type?: unknown }).type !== 'kitchen_requisition') {
		return false;
	}
	const doc = d as Record<string, unknown>;
	if (doc.status === undefined) {
		doc.status = 'approved';
	}
	if (!doc.requested_at) {
		doc.requested_at = doc.issued_at ?? doc.created_at ?? new Date().toISOString();
	}
	if (doc.status === 'approved' && !doc.approved_at) {
		doc.approved_at = doc.issued_at ?? doc.created_at;
	}
	return true;
};

// ---- KitchenCounter (schema.md §2.7.4) --------------------------------
export interface KitchenCounter extends BaseDoc {
	_id: 'kitchen_counter:main';
	type: 'kitchen_counter';
	seq: number;
}

export const isKitchenCounter = (d: unknown): d is KitchenCounter =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'kitchen_counter';

// ---- MealService (append-only record of meal distribution) ------------

export interface MealServiceExternal {
	volunteers: number;
	outside_evacuees: number;
}

export interface MealService extends BaseDoc {
	type: 'meal_service';
	date: string;
	meal: MealPeriod;
	meal_plan_id: string | null;
	meal_session_id?: string | null;
	// Portions produced by the kitchen (distinct from served).
	actual_yield?: number;
	served: number;
	waste: number;
	external: MealServiceExternal;
	notes?: string;
}

export const mealServiceInputSchema = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
	meal: mealPeriodSchema,
	meal_plan_id: z.string().nullable().default(null),
	meal_session_id: z.string().nullable().optional(),
	actual_yield: z.number().int().min(0).nullable().optional(),
	served: z.number().int().min(0),
	waste: z.number().int().min(0),
	external: z.object({
		volunteers: z.number().int().min(0),
		outside_evacuees: z.number().int().min(0)
	}),
	notes: z.string().trim().optional()
});
export type MealServiceInput = z.input<typeof mealServiceInputSchema>;

export function createMealService(input: MealServiceInput, ctx: AuthorContext): MealService {
	const d = mealServiceInputSchema.parse(input);
	return makeDoc(
		'meal_service',
		2,
		{
			date: d.date,
			meal: d.meal,
			meal_plan_id: d.meal_plan_id,
			...(d.meal_session_id !== undefined ? { meal_session_id: d.meal_session_id } : {}),
			// Preserve 0 as a valid recorded yield.
			...(d.actual_yield != null ? { actual_yield: d.actual_yield } : {}),
			served: d.served,
			waste: d.waste,
			external: d.external,
			...(d.notes ? { notes: d.notes } : {})
		},
		ctx
	);
}

export const isMealService = (d: unknown): d is MealService =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'meal_service';

// ---- MealServiceReceipt (append-only warehouse receipt decision, CR-144/CR-145) ----
// `meal_service` is append-only (schema.md §1817 invariant) — can't add
// received_by/received_at/outcome to that doc, so the warehouse's decision is
// its own doc instead, same pattern as stock_ledger event rows.

export const mealServiceReceiptOutcomeSchema = z.enum(['confirmed', 'rejected']);
export type MealServiceReceiptOutcome = z.infer<typeof mealServiceReceiptOutcomeSchema>;

export interface MealServiceReceipt extends BaseDoc {
	type: 'meal_service_receipt';
	meal_service_id: string;
	// Optional for backward compat — docs written before CR-145 predate this
	// field and only ever meant "confirmed"; see mealServiceReceiptOutcome().
	outcome?: MealServiceReceiptOutcome;
	received_by: string;
	reason?: string; // required when outcome = 'rejected'
}

/** Reads a receipt's outcome, treating a pre-CR-145 doc (no `outcome` field) as 'confirmed'. */
export function mealServiceReceiptOutcome(receipt: MealServiceReceipt): MealServiceReceiptOutcome {
	return receipt.outcome ?? 'confirmed';
}

export function createMealServiceReceipt(
	mealServiceId: string,
	outcome: MealServiceReceiptOutcome,
	ctx: AuthorContext,
	reason?: string
): MealServiceReceipt {
	return makeDoc(
		'meal_service_receipt',
		1,
		{
			meal_service_id: mealServiceId,
			outcome,
			received_by: ctx.createdBy,
			...(reason ? { reason } : {})
		},
		ctx
	);
}

export const isMealServiceReceipt = (d: unknown): d is MealServiceReceipt =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'meal_service_receipt';

export type KitchenDoc =
	MealSession | MealPlan | KitchenRequisition | KitchenCounter | MealService | MealServiceReceipt;
