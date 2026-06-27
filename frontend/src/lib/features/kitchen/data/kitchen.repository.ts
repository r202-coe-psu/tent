import type {
	MealPlan,
	MealPlanInput,
	KitchenRequisition,
	KitchenRequisitionInput,
	MealService,
	MealServiceInput
} from '../domain/kitchen';
import type { AuthorContext } from '$lib/db/model';

export interface KitchenRepository {
	// MealPlan — deterministic _id: meal_plan:{date}:{meal}
	createMealPlan(input: MealPlanInput, ctx: AuthorContext): Promise<MealPlan>;
	getMealPlan(date: string, meal: string): Promise<MealPlan | null>;
	listMealPlans(): Promise<MealPlan[]>;

	// KitchenRequisition — append-only; writes stock_ledger entries atomically
	issueRequisition(input: KitchenRequisitionInput, ctx: AuthorContext): Promise<KitchenRequisition>;
	listRequisitions(): Promise<KitchenRequisition[]>;

	// MealService — deterministic _id: meal_service:{date}:{meal}, append-only
	recordMealService(input: MealServiceInput, ctx: AuthorContext): Promise<MealService>;
	getMealService(date: string, meal: string): Promise<MealService | null>;
	listMealServices(): Promise<MealService[]>;
}
