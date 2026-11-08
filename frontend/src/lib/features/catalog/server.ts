/**
 * Server-safe entry point for the catalog feature.
 *
 * Keeps domain logic, validation guards, and types accessible to server-side code (BFF endpoints)
 * without pulling in browser-specific dependencies.
 */

export {
	isItemMaster,
	itemMasterUnit,
	requiresExpiry,
	qtyToBaseUnit,
	packagingMultiplier,
	DEFAULT_ITEM_UNIT
} from './domain/catalog';
export type { ItemMaster, PackagingSource } from './domain/catalog';
