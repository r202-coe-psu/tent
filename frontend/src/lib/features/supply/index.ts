/**
 * Public API of the `supply` feature (catalog items — T-10 stub).
 * Cross-feature and route code imports ONLY from here.
 */

// Domain — document type
export type { SupplyItem, SupplyCategory, SupplyItemInput } from './domain/supply';
export type { StockThresholdOverride, SaveThresholdOverrideInput } from './domain/threshold-override';

// Domain — schemas + enum labels + guard
export {
	supplyCategorySchema,
	supplyItemSchema,
	isSupplyItem,
	SUPPLY_CATEGORY_LABELS
} from './domain/supply';
export {
	stockThresholdOverrideSchema,
	isStockThresholdOverride
} from './domain/threshold-override';

// Data — repository contract + remote CouchDB binding
export type { SupplyRepository } from './data/supply.repository';
export { supplyRepository, CATALOG_DB } from './data/supply.remote';

// Application — TanStack Query hooks
export {
	supplyKeys,
	useSupplyItems,
	useSupplyItem,
	useThresholdOverrides,
	useSaveThresholdOverride,
	startCatalogLiveQuery
} from './application/queries';

