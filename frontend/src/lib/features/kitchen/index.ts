// Domain — documents
export type {
	ProductionLog,
	KitchenDoc,
	ProductionStatus,
	MealPeriod,
	ProductionLogInput
} from './domain/kitchen';

// Domain — schemas, factories, helpers
export {
	productionStatusSchema,
	mealPeriodSchema,
	productionLogInputSchema,
	createProductionLog,
	isProductionLog,
	STATUS_CONFIG,
	MEAL_PERIOD_LABELS,
	shortCode
} from './domain/kitchen';

// Data — repository contract + PouchDB binding
export type { KitchenRepository } from './data/kitchen.repository';
export { kitchenRepository, kitchenDb, SHELTER_CODE, SHELTER_DB } from './data/kitchen.pouch';

// Application — TanStack Query hooks + live-query wiring
export {
	kitchenKeys,
	useProductionLogs,
	useCreateProductionLog,
	useUpdateProductionLog,
	startKitchenLiveQuery
} from './application/queries';
