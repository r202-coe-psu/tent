import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { isSupplyItem, type SupplyItem } from '../domain/supply';
import type { SupplyRepository } from './supply.repository';

/**
 * PouchDB-backed implementation of the supply catalog repository.
 *
 * Reads from the `catalog` database (schema.md §4). This database is
 * centrally managed and synced down to each device via `startNamedSync('catalog')`.
 *
 * Important: supply item `_id` uses prefix `item:` (e.g. `item:01J…`),
 * while the `type` field is `'supply_item'`. We scan by `_id` prefix `'item'`
 * and filter with the `isSupplyItem` type guard.
 */
export const CATALOG_DB = 'catalog';

export class SupplyCatalogPouchRepository implements SupplyRepository {
	private readonly repo: Repository;

	constructor(dbName: string = CATALOG_DB) {
		this.repo = createRepository(namedLocalDb(dbName));
	}

	listItems(): Promise<SupplyItem[]> {
		// Prefix scan on `item:` (the _id prefix), guard on type === 'supply_item'
		return this.repo.allByType('item', isSupplyItem);
	}

	getItem(id: string): Promise<SupplyItem | null> {
		return this.repo.get<SupplyItem>(id);
	}
}

let singleton: SupplyRepository | null = null;

/** Singleton accessor — reuses one repository instance per session. */
export function supplyRepository(): SupplyRepository {
	if (!singleton) singleton = new SupplyCatalogPouchRepository();
	return singleton;
}
