import type { SupplyItem } from '../domain/supply';
import type { AuthorContext } from '$lib/db/model';
import type { StockThresholdOverride } from '../domain/threshold-override';


/**
 * Read-only repository contract for the supply catalog.
 *
 * The catalog is centrally managed — shelters only pull data down.
 * No create/update/delete operations are exposed here.
 */
export interface SupplyRepository {
	/** List all supply items in the catalog. */
	listItems(): Promise<SupplyItem[]>;

	/** Fetch a single supply item by its `_id` (e.g. `item:{ulid}`). */
	getItem(id: string): Promise<SupplyItem | null>;

	listThresholdOverrides(): Promise<StockThresholdOverride[]>;
	saveThresholdOverride(override: Omit<StockThresholdOverride, 'type' | 'schema_v'>, ctx: AuthorContext): Promise<StockThresholdOverride>;




}

