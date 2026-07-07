import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { isSupplyItem, type SupplyItem } from '../domain/supply';
import type { SupplyRepository } from './supply.repository';

/**
 * Remote CouchDB implementation of the supply catalog repository.
 *
 * Reads from the `catalog` database (schema.md §4) via the active central endpoint.
 */
export const CATALOG_DB = 'catalog';

export class SupplyCatalogRemoteRepository implements SupplyRepository {
	private readonly repo: Repository;

	constructor(dbName: string = CATALOG_DB) {
		this.repo = createRemoteRepository(dbName);
	}

	listItems(): Promise<SupplyItem[]> {
		return this.repo.allByType('item', isSupplyItem);
	}

	getItem(id: string): Promise<SupplyItem | null> {
		return this.repo.get<SupplyItem>(id);
	}
}

let singleton: SupplyRepository | null = null;

export function supplyRepository(): SupplyRepository {
	if (!singleton) singleton = new SupplyCatalogRemoteRepository();
	return singleton;
}
