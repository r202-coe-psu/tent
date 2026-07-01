// UI components
export { default as MealPlanList } from './ui/meal-plan-list.svelte';
export { default as MealPlanForm } from './ui/meal-plan-form.svelte';
export { default as GasManagement } from './ui/gas-management.svelte';

// Domain — meal calculation + T-26 handoff (T-25)
export {
	calculateMealIngredients,
	toRequisitionInput,
	RICE_RECIPE_ID,
	RECIPE_TO_STOCK_ITEM
} from './domain/meal-calc';
export type { MealCalcSource, MealCalcResult } from './domain/meal-calc';

// Domain — occupancy → headcount (T-06 source)
export { deriveHeadcountFromOccupancy, SOFT_FOOD_NEEDS } from './domain/occupancy';
export type { OccupantView } from './domain/occupancy';

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
	useOccupancyHeadcount,
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
