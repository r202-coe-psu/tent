// UI components
export { default as MealPlanList } from './ui/meal-plan-list.svelte';
export { default as MealPlanForm } from './ui/meal-plan-form.svelte';
export { default as GasManagement } from './ui/gas-management.svelte';

// Domain — meal calculation (T-25)
export { calculateMealIngredients, RICE_RECIPE_ID } from './domain/meal-calc';
export type { MealCalcSource, MealCalcResult } from './domain/meal-calc';

// Domain — documents
export type {
	MealPlan,
	MealPlanHeadcount,
	MealPlanRecipe,
	KitchenRequisition,
	KitchenRequisitionItem,
	MealService,
	MealServiceExternal,
	KitchenDoc,
	MealPeriod,
	MealPlanStatus,
	MealPlanInput,
	KitchenRequisitionInput,
	MealServiceInput,
	GasCylinderType,
	GasCylinderTypeInput
} from './domain/kitchen';

// Domain — schemas, factories, guards, labels
export {
	mealPeriodSchema,
	mealPlanStatusSchema,
	mealPlanInputSchema,
	kitchenRequisitionInputSchema,
	mealServiceInputSchema,
	createMealPlan,
	createKitchenRequisition,
	createMealService,
	isMealPlan,
	isKitchenRequisition,
	isMealService,
	MEAL_PERIOD_LABELS
} from './domain/kitchen';

// Data — repository contract + PouchDB binding
export type { KitchenRepository } from './data/kitchen.repository';
export { kitchenRepository, SHELTER_CODE, SHELTER_DB } from './data/kitchen.pouch';

// Application — TanStack Query hooks + live-query wiring
export {
	kitchenKeys,
	useMealPlans,
	useCreateMealPlan,
	useCreateMealPlanCalc,
	useConfirmMealPlan,
	useRequisitions,
	useIssueRequisition,
	useMealServices,
	useRecordMealService,
	useGasCylinderTypes,
	useCreateGasCylinderType,
	useUpdateGasCylinderType,
	useDeleteGasCylinderType,
	startKitchenLiveQuery
} from './application/queries';
