import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { isSupplyItem, type SupplyItem } from '../domain/supply';
import type { SupplyRepository } from './supply.repository';
import { getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext, now } from '$lib/db/model';
import { isStockThresholdOverride, type StockThresholdOverride } from '../domain/threshold-override';


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

	async listThresholdOverrides(): Promise<StockThresholdOverride[]> {
		const shelterRepo = createRemoteRepository(getShelterDb());
		return shelterRepo.allByType('stock_threshold_override', isStockThresholdOverride);
	}

	async saveThresholdOverride(override: Omit<StockThresholdOverride, 'type' | 'schema_v'>, ctx: AuthorContext): Promise<StockThresholdOverride> {
		const shelterRepo = createRemoteRepository(getShelterDb());
		const existing = await shelterRepo.get<StockThresholdOverride>(override._id).catch(() => null);
		const updatedDoc = existing
			? touch({ ...existing, ...override })
			: {
				...override,
				type: 'stock_threshold_override' as const,
				schema_v: 1 as const,
				shelter_code: ctx.shelterCode,
				created_at: now(),
				updated_at: now(),
				created_by: ctx.createdBy
			};
		// Validate with Zod schema before put
		stockThresholdOverrideSchema.parse(updatedDoc);

		return shelterRepo.put(updatedDoc);
	}
}

let singleton: SupplyRepository | null = null;

export function supplyRepository(): SupplyRepository {
	if (!singleton) singleton = new SupplyCatalogRemoteRepository();
	return singleton;
}
