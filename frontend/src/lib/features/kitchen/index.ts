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
	MealServiceInput
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
	useRequisitions,
	useIssueRequisition,
	useMealServices,
	useRecordMealService,
	startKitchenLiveQuery
} from './application/queries';
