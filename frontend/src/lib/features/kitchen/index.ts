// UI components
export { default as MealPlanList } from './ui/meal-plan-list.svelte';
export { default as MealPlanForm } from './ui/meal-plan-form.svelte';
export { default as GasManagement } from './ui/gas-management.svelte';
export { default as RequisitionDialog } from './ui/requisition-dialog.svelte';
export { default as RequisitionHistory } from './ui/requisition-history.svelte';
export { default as MealServiceForm } from './ui/meal-service-form.svelte';
export { default as MealServiceSummary } from './ui/meal-service-summary.svelte';

// Domain — meal calculation + T-26 handoff (T-25)
export {
	calculateMealIngredients,
	calculateMealIngredientsFromRecipe,
	calculateMealIngredientsFromCustom,
	toRequisitionInput,
	assessRequisition,
	RICE_RECIPE_ID,
	EGG_RECIPE_ID,
	VEGETABLE_RECIPE_ID,
	RECIPE_TO_STOCK_ITEM,
	RECIPE_LABELS,
	DEFAULT_RICE_G_PER_PERSON_MEAL
} from './domain/meal-calc';
export type {
	MealCalcSource,
	MealCalcResult,
	CustomIngredientInput,
	StockAvailabilityStatus,
	RequisitionLineAssessment
} from './domain/meal-calc';

// Domain — plan vs actual variance (T-27)
export { computeMealVariance, VARIANCE_TOLERANCE_PCT } from './domain/meal-variance';
export type { MealVariance, MealVarianceStatus } from './domain/meal-variance';

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
	MEAL_PERIOD_LABELS,
	MealPlanAlreadyExistsError
} from './domain/kitchen';

// Data — repository contract + remote CouchDB binding
export type { KitchenRepository } from './data/kitchen.repository';
export { kitchenRepository } from './data/kitchen.remote';

// Application — TanStack Query hooks + live-query wiring
export {
	kitchenKeys,
	useMealPlans,
	useOccupancyHeadcount,
	useCreateMealPlan,
	useCreateMealPlanCalc,
	useConfirmMealPlan,
	useUpdateMealPlanCalc,
	useDeleteMealPlanDraft,
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
