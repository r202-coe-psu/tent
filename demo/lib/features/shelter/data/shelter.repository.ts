import type { InventoryItem, Occupant, ShelterConfig, StockTxn } from '../domain/shelter';

/**
 * Persistence contract for a SINGLE shelter's data. The application layer
 * depends on this interface, never on PouchDB directly, so the store can be
 * swapped (in-memory in tests, REST, etc.) without touching queries or UI.
 */
export interface ShelterRepository {
	getConfig(): Promise<ShelterConfig | null>;
	saveConfig(config: ShelterConfig): Promise<void>;

	listOccupants(): Promise<Occupant[]>;
	saveOccupant(occupant: Occupant): Promise<void>;

	listItems(): Promise<InventoryItem[]>;
	saveItem(item: InventoryItem): Promise<void>;

	listTxns(): Promise<StockTxn[]>;
	addTxn(txn: StockTxn): Promise<void>;
}
