import type { AuthorContext } from '$lib/db/model';
import type { StockLedger, ReceiveInput } from '../domain/operations';

/**
 * Repository contract for managing stock ledger entries and calculating inventory balances.
 *
 * All stock ledger entries are append-only.
 */
export interface OperationsRepository {
	/**
	 * Persist a new stock ledger entry (append-only).
	 */
	addLedgerEntry(entry: StockLedger): Promise<StockLedger>;

	/**
	 * Retrieve all stock ledger entries in the current shelter database.
	 */
	listLedger(): Promise<StockLedger[]>;

	/**
	 * Retrieve stock ledger entries filtered by item ID.
	 */
	listLedgerByItem(itemId: string): Promise<StockLedger[]>;

	/**
	 * Calculate current on-hand stock balance for all items (sum of signed deltas).
	 */
	getBalance(): Promise<Map<string, number>>;

	/**
	 * Process and persist an inbound stock receive entry.
	 */
	receiveStock(input: ReceiveInput, ctx: AuthorContext): Promise<StockLedger>;
}
