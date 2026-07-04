import type { AuthorContext } from '$lib/db/model';
import type { StockLedger, ReceiveInput, DistributeInput, StockTransfer, TransferInput } from '../domain/operations';

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

	/**
	 * Process and persist an outbound stock distribute entry.
	 * Will throw an error if there is insufficient stock.
	 */
	distributeStock(input: DistributeInput, ctx: AuthorContext): Promise<StockLedger>;

	/**
	 * Create a new transfer request in 'requested' state.
	 */
	createTransfer(input: TransferInput, ctx: AuthorContext): Promise<StockTransfer>;

	/**
	 * Dispatch a transfer (change state to 'shipped' and deduct stock via transfer_out ledgers).
	 * Will throw an error if there is insufficient stock.
	 */
	dispatchTransfer(transfer: StockTransfer, ctx: AuthorContext): Promise<{ transfer: StockTransfer; ledgers: StockLedger[] }>;
}
