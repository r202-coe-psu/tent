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

// ---- MealPlan (schema.md §2.5) ----------------------------------------
// _id is deterministic: "meal_plan:{date}:{meal}" — one doc per day+meal.
// Collision on two devices → CouchDB conflict, not a duplicate doc.

export interface MealPlanHeadcount {
	total: number;
	halal: number;
	soft_food: number;
	infant: number;
}

export interface MealPlanRecipe {
	recipe_id: string;
	planned_qty: number;
	// Present when the plan was built from a catalog Recipe (BOM) or a custom
	// ad-hoc ingredient list instead of the fixed SOP-ratio rice calc — in both
	// cases recipe_id is used as-is for the stock_ledger item_id (no static
	// RECIPE_TO_STOCK_ITEM mapping for it) and unit carries its real stock unit.
	// A BOM recipe_id is a catalog `item_master:*` id (no stock link yet); a
	// custom recipe_id is a `supply_item` `item:*` id (already stock-linked) —
	// see meal-plan-list.svelte's isBomSourced for how these are told apart.
	unit?: string;
}

export interface MealPlan extends BaseDoc {
	type: 'meal_plan';
	date: string;
	meal: MealPeriod;
	// Optional display name for a custom/BOM-sourced menu (e.g. "ข้าวไก่กรอบ") —
	// the SOP rice-only path has no name, so this stays unset there.
	label?: string;
	headcount: MealPlanHeadcount;
	recipes: MealPlanRecipe[];
	status: MealPlanStatus;
	override_reason?: string | null;
	calc_source?: MealCalcSource | null;
}

// meal_plan:{date}:{meal} is a deterministic _id, and the shared repository
// primitive (putDoc, $lib/db/couch-db.ts) treats a create-time 409 on a
// deterministic id as an idempotent success — resolving with the pre-existing
// doc instead of throwing. That's correct for append-only docs (meal_service),
// but a meal plan must NOT silently reuse an old plan when someone tries to
// create a second one for the same date+meal. The application layer detects
// the replay (returned doc's calc_source.headcount_as_of won't match what was
// just computed) and throws this instead, so the UI shows an error rather than
// a false "created" toast.
export class MealPlanAlreadyExistsError extends Error {
	constructor(
		public readonly date: string,
		public readonly meal: MealPeriod
	) {
		super(`meal_plan already exists for ${date}:${meal}`);
		this.name = 'MealPlanAlreadyExistsError';
	}
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
			// Sub-counts are orthogonal dimensions (a person may be both muslim and
			// an infant), so each is bounded by total independently — not their sum. CR-022.
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
		.optional()
});
export type MealPlanInput = z.input<typeof mealPlanInputSchema>;

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
			...(d.calc_source != null ? { calc_source: d.calc_source } : {})
		},
		ctx,
		`${d.date}:${d.meal}` // deterministic suffix
	);
}

export const isMealPlan = (d: unknown): d is MealPlan =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'meal_plan';

// ---- KitchenRequisition (schema.md §2.6) — append-only ----------------
// ledger_ids must be pre-populated at creation (append-only → no updates).

export interface KitchenRequisitionItem {
	item_id: string;
	qty_requested: string; // qty_str
	qty_issued: string; // qty_str
	unit: string;
}

export interface KitchenRequisition extends BaseDoc {
	type: 'kitchen_requisition';
	meal_plan_id: string | null;
	items: KitchenRequisitionItem[];
	ledger_ids: string[];
	issued_at: Timestamp;
}

export const kitchenRequisitionInputSchema = z.object({
	meal_plan_id: z.string().nullable().default(null),
	items: z
		.array(
			z
				.object({
					item_id: z.string().min(1),
					qty_requested: qtyStrCoercePositiveSchema,
					qty_issued: qtyStrCoerceNonNegativeSchema,
					unit: z.string().trim().min(1)
				})
				// Issuing more than requested is meaningless — a requisition line can
				// short (partial issue) but never over-issue. Enforced here so the
				// invariant holds outside the UI clamp (assessRequisition's issuable).
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
	return makeDoc(
		'kitchen_requisition',
		2,
		{
			meal_plan_id: d.meal_plan_id,
			items: d.items.map((i) => ({
				...i,
				qty_requested: persistQty(i.qty_requested),
				qty_issued: persistQty(i.qty_issued)
			})),
			ledger_ids: ledgerIds,
			issued_at: new Date().toISOString()
		},
		ctx
	);
}

export const isKitchenRequisition = (d: unknown): d is KitchenRequisition =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'kitchen_requisition';

// ---- MealService (schema.md §2.7) — deterministic _id, append-only ----
// _id: "meal_service:{date}:{meal}" — same deterministic pattern as meal_plan.

export interface MealServiceExternal {
	volunteers: number;
	outside_evacuees: number;
}

export interface MealService extends BaseDoc {
	type: 'meal_service';
	date: string;
	meal: MealPeriod;
	served: number;
	waste: number;
	external: MealServiceExternal;
	notes?: string;
}

export const mealServiceInputSchema = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
	meal: mealPeriodSchema,
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
		1,
		{
			date: d.date,
			meal: d.meal,
			served: d.served,
			waste: d.waste,
			external: d.external,
			...(d.notes ? { notes: d.notes } : {})
		},
		ctx,
		`${d.date}:${d.meal}` // deterministic suffix
	);
}

export const isMealService = (d: unknown): d is MealService =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'meal_service';

export type KitchenDoc = MealPlan | KitchenRequisition | MealService;

// ---- GasCylinderType — mutable config, LWW via touch() ------------------
// _id: "gas_cylinder_type:{ulid}" — one doc per stove/tank combo.

export interface GasCylinderType extends BaseDoc {
	type: 'gas_cylinder_type';
	name: string;
	capacity_kg: string; // qty_str
	burn_rate_kg_per_hour: string; // qty_str
	time_multiplier: string; // qty_str
}

export const gasCylinderTypeInputSchema = z.object({
	name: z.string().trim().min(1, 'Name required'),
	capacity_kg: qtyStrCoercePositiveSchema,
	burn_rate_kg_per_hour: qtyStrCoercePositiveSchema,
	time_multiplier: qtyStrCoercePositiveSchema.default('1')
});
export type GasCylinderTypeInput = z.input<typeof gasCylinderTypeInputSchema>;

export function createGasCylinderType(
	input: GasCylinderTypeInput,
	ctx: AuthorContext
): GasCylinderType {
	const d = gasCylinderTypeInputSchema.parse(input);
	return makeDoc(
		'gas_cylinder_type',
		2,
		{
			name: d.name,
			capacity_kg: persistQty(d.capacity_kg),
			burn_rate_kg_per_hour: persistQty(d.burn_rate_kg_per_hour),
			time_multiplier: persistQty(d.time_multiplier)
		},
		ctx
	);
}

export const isGasCylinderType = (d: unknown): d is GasCylinderType =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'gas_cylinder_type';
