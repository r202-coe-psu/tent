import type { AuthorContext } from '$lib/db/model';
import {
	catalogRepository,
	canonicalizeUnitCode,
	itemMasterUnit,
	type CatalogRepository
} from '$lib/features/catalog';
import { WorkflowValidationError } from './errors';

export type CanonicalUnitCatalogRepository = Pick<
	CatalogRepository,
	'listItemMasters' | 'listUnitsOfMeasure'
>;

/**
 * Resolves the authoritative persisted unit for Distribution writes.
 * Item masters own stock units; labels are normalized only through Catalog UOM.
 */
export async function resolveCanonicalItemUnits(
	itemIds: readonly string[],
	ctx: AuthorContext,
	catalog: CanonicalUnitCatalogRepository = catalogRepository()
): Promise<Map<string, string>> {
	const uniqueIds = [...new Set(itemIds)];
	const [items, units] = await Promise.all([
		catalog.listItemMasters(ctx.shelterCode),
		catalog.listUnitsOfMeasure()
	]);
	const itemsById = new Map(items.map((item) => [item._id, item]));
	const resolved = new Map<string, string>();

	for (const itemId of uniqueIds) {
		const item = itemsById.get(itemId);
		if (!item) {
			throw new WorkflowValidationError(
				`Cannot resolve canonical unit: item master ${itemId} was not found`
			);
		}
		const unit = canonicalizeUnitCode(itemMasterUnit(item), units);
		if (!unit) {
			throw new WorkflowValidationError(`Cannot resolve canonical unit for item master ${itemId}`);
		}
		resolved.set(itemId, unit);
	}

	return resolved;
}
