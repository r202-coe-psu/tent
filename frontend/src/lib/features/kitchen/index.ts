// UI components
export { default as MealPlanList } from './ui/meal-plan-list.svelte';
export { default as MealPlanForm } from './ui/meal-plan-form.svelte';
export { default as GasManagement } from './ui/gas-management.svelte';
export { default as RequisitionDialog } from './ui/requisition-dialog.svelte';
export { default as RequisitionHistory } from './ui/requisition-history.svelte';
export { default as MealServiceForm } from './ui/meal-service-form.svelte';
export { default as MealServiceSummary } from './ui/meal-service-summary.svelte';
export { default as MealSessionList } from './ui/MealSessionList.svelte';
export { default as KitchenRequisitionList } from './ui/KitchenRequisitionList.svelte';

// Domain — meal calculation and requisition
export {
	calculateMealIngredients,
	calculateMealIngredientsFromRecipe,
	calculateMealIngredientsFromCustom,
	resolveItemMasterStock,
	toRequisitionInput,
	assessRequisition,
	formatTicketNo,
	expandTargetTags,
	computeSessionGroupProgress,
	toMealPlanMap,
	sumHeadcountByTags,
	getActiveTagsFromSession,
	TARGET_GROUP_TAGS,
	TARGET_GROUP_LABELS,
	RICE_RECIPE_ID,
	RECIPE_TO_STOCK_ITEM,
	RECIPE_LABELS,
	DEFAULT_RICE_G_PER_PERSON_MEAL
} from './domain/meal-calc';
export type {
	MealCalcSource,
	MealCalcResult,
	CustomIngredientInput,
	ResolvedItemMaster,
	StockAvailabilityStatus,
	RequisitionLineAssessment,
	TargetGroupTag,
	GroupProgressItem,
	SessionGroupProgress
} from './domain/meal-calc';

// Domain — plan vs actual variance
export {
	computeMealVariance,
	VARIANCE_TOLERANCE_PCT,
	MEAL_VARIANCE_STATUS_LABELS
} from './domain/meal-variance';
export type { MealVariance, MealVarianceStatus } from './domain/meal-variance';

// Domain — gas consumption
export {
	calculateGasConsumptionKg,
	cylindersNeeded,
	cookingHoursFromConsumptionKg,
	calculateMaxCookingHours,
	calculateCookingHoursFromPortions
} from './domain/gas-calc';
export type { GasBurnCoefficients } from './domain/gas-calc';

// Domain — gas cylinder stock ledger
export {
	gasLedgerReasonSchema,
	createGasLedgerEntry,
	isGasLedgerEntry,
	gasCylinderBalance,
	gasCylinderStatus,
	maxRefillKg
} from './domain/gas-ledger';
export type {
	GasLedgerEntry,
	GasLedgerInput,
	GasLedgerReason,
	GasCylinderStatus
} from './domain/gas-ledger';

// Domain — occupancy to headcount
export {
	deriveHeadcountFromOccupancy,
	deriveSessionHeadcountFromOccupancy,
	SOFT_FOOD_NEEDS
} from './domain/occupancy';
export type { OccupantView } from './domain/occupancy';

// Domain — documents
export type {
	MealSession,
	MealSessionHeadcount,
	MealSessionStatus,
	MealSessionInput,
	KitchenCounter,
	MealPlan,
	MealPlanHeadcount,
	MealPlanRecipe,
	MealPlanGasUsage,
	KitchenRequisition,
	KitchenRequisitionStatus,
	KitchenRequisitionItem,
	KitchenRequisitionGasDrawdown,
	MealService,
	MealServiceExternal,
	KitchenDoc,
	MealPeriod,
	MealPlanStatus,
	MealPlanInput,
	KitchenRequisitionInput,
	PendingRequisitionInput,
	MealServiceInput,
	GasCylinderType,
	GasCylinderTypeInput
} from './domain/kitchen';

// Domain — schemas, factories, guards, labels
export {
	mealSessionStatusSchema,
	mealSessionInputSchema,
	createMealSession,
	isMealSession,
	isKitchenCounter,
	mealPeriodSchema,
	mealPlanStatusSchema,
	mealPlanInputSchema,
	kitchenRequisitionInputSchema,
	pendingRequisitionInputSchema,
	mealServiceInputSchema,
	createMealPlan,
	createKitchenRequisition,
	createPendingRequisition,
	createMealService,
	isMealPlan,
	isKitchenRequisition,
	gasCylinderTypeInputSchema,
	createGasCylinderType,
	isGasCylinderType,
	isMealService,
	MEAL_PERIOD_LABELS
} from './domain/kitchen';

// Data — repository and remote CouchDB binding
export type {
	KitchenRepository,
	CreatePendingRequisitionParams,
	ApproveRequisitionOptions
} from './data/kitchen.repository';
export { kitchenRepository } from './data/kitchen.remote';

// Application — query hooks and live-query wiring
export {
	kitchenKeys,
	useMealSessions,
	useMealSession,
	useCreateMealSession,
	useUpdateMealSession,
	useDeleteMealSession,
	useMealPlans,
	useOccupancyHeadcount,
	useActiveEvacueeDietCounts,
	useCreateMealPlan,
	useCreateMealPlanCalc,
	useConfirmMealPlan,
	useUpdateMealPlanCalc,
	useDeleteMealPlanDraft,
	useRequisitions,
	useKitchenRequisitions,
	useKitchenRequisition,
	useCreatePendingRequisition,
	useApproveRequisitionTicket,
	useRejectRequisitionTicket,
	useIssueRequisition,
	useMealServices,
	useRecordMealService,
	useGasCylinderTypes,
	useCreateGasCylinderType,
	useUpdateGasCylinderType,
	useDeleteGasCylinderType,
	useGasLedger,
	useRefillGasCylinder,
	useWriteOffGasCylinder,
	startKitchenLiveQuery
} from './application/queries';
