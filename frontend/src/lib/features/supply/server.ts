/**
 * Server-safe entry point for the supply (catalog) feature.
 *
 * The feature barrel re-exports the application layer (TanStack Query hooks) and
 * the remote CouchDB repository, both browser-only. Server code validating stock
 * writes against the catalog only needs the pure domain guard/type plus the
 * catalog database name — same rationale as `$lib/features/shelters/server`.
 */

export { CATALOG_DB, isSupplyItem, supplyItemSchema, supplyCategorySchema } from './domain/supply';
export type { SupplyItem, SupplyCategory } from './domain/supply';
export {
	isStockThresholdOverride,
	stockThresholdOverrideSchema
} from './domain/threshold-override';
export type {
	StockThresholdOverride,
	SaveThresholdOverrideInput
} from './domain/threshold-override';
export { calculateReorderLevel } from './domain/threshold-calc';
