/**
 * Public API of the `supply` feature (catalog items — T-10 stub).
 * Cross-feature and route code imports ONLY from here.
 */

// Domain — document type
export type { SupplyItem, SupplyCategory, SupplyItemInput } from './domain/supply';

// Domain — schemas + enum labels + guard
export {
	supplyCategorySchema,
	supplyItemSchema,
	isSupplyItem,
	SUPPLY_CATEGORY_LABELS
} from './domain/supply';

// Data — repository contract + PouchDB binding
export type { SupplyRepository } from './data/supply.repository';
export { supplyRepository, catalogDb, CATALOG_DB } from './data/supply.pouch';

// Application — TanStack Query hooks
export { supplyKeys, useSupplyItems, useSupplyItem } from './application/queries';
