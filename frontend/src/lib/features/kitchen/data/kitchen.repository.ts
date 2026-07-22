import type {
	MealPlan,
	MealPlanInput,
	KitchenRequisition,
	KitchenRequisitionInput,
	MealService,
	MealServiceInput,
	GasCylinderType,
	GasCylinderTypeInput
} from '../domain/kitchen';
import type { AuthorContext } from '$lib/db/model';

export interface KitchenRepository {
	// MealPlan — deterministic _id: meal_plan:{date}:{meal}
	createMealPlan(input: MealPlanInput, ctx: AuthorContext): Promise<MealPlan>;
	getMealPlan(date: string, meal: string): Promise<MealPlan | null>;
	listMealPlans(): Promise<MealPlan[]>;
	confirmMealPlan(plan: MealPlan): Promise<MealPlan>;
	// Draft-only — a confirmed plan may already be requisitioned/serviced, so
	// editing or deleting it would orphan those records' meal_plan_id reference.
	updateMealPlanDraft(
		plan: MealPlan,
		patch: Pick<MealPlan, 'headcount' | 'recipes' | 'calc_source' | 'override_reason' | 'label'>
	): Promise<MealPlan>;
	deleteMealPlanDraft(plan: MealPlan): Promise<void>;

	// KitchenRequisition — append-only; writes stock_ledger entries atomically
	issueRequisition(input: KitchenRequisitionInput, ctx: AuthorContext): Promise<KitchenRequisition>;
	listRequisitions(): Promise<KitchenRequisition[]>;

	// MealService — deterministic _id: meal_service:{date}:{meal}, append-only
	recordMealService(input: MealServiceInput, ctx: AuthorContext): Promise<MealService>;
	getMealService(date: string, meal: string): Promise<MealService | null>;
	listMealServices(): Promise<MealService[]>;

	// GasCylinderType — reference data
	createGasCylinderType(input: GasCylinderTypeInput, ctx: AuthorContext): Promise<GasCylinderType>;
	listGasCylinderTypes(): Promise<GasCylinderType[]>;
	updateGasCylinderType(
		doc: GasCylinderType,
		input: GasCylinderTypeInput
	): Promise<GasCylinderType>;
	deleteGasCylinderType(doc: GasCylinderType): Promise<void>;
}
