import type { AuthorContext } from '$lib/db/model';
import type {
	DonationCampaign,
	CampaignInput,
	StockLedger,
	ReceiveInput,
	DistributeInput,
	Donation,
	DonationSlot,
	StockTransfer,
	TransferInput
} from '../domain/operations';
import type { AuditAction } from '$lib/features/shared';

/**
 * Persistence contract for the `operations` feature (stock, campaigns, donations, transfers).
 * Allows UI and query layers to query and mutate data independent of specific PouchDB API shapes.
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
	dispatchTransfer(
		transfer: StockTransfer,
		ctx: AuthorContext
	): Promise<{ transfer: StockTransfer; ledgers: StockLedger[] }>;

	/**
	 * Receive a transfer (change state to 'received' and add stock via transfer_in ledgers).
	 */
	receiveTransfer(
		transfer: StockTransfer,
		receivedItems: { item_id: string; qty: number }[],
		ctx: AuthorContext
	): Promise<{ transfer: StockTransfer; ledgers: StockLedger[] }>;

	/**
	 * List incoming transfers that are in 'shipped' state.
	 */
	listIncomingTransfers(): Promise<StockTransfer[]>;

	// Campaign/Donation/Slot methods
	listCampaigns(): Promise<DonationCampaign[]>;
	getCampaign(id: string): Promise<DonationCampaign | null>;
	createCampaign(input: CampaignInput, ctx: AuthorContext): Promise<DonationCampaign>;
	updateCampaign(
		campaign: DonationCampaign,
		auditInput?: { action: AuditAction; reason: string; ctx: AuthorContext }
	): Promise<DonationCampaign>;
	listDonations(): Promise<Donation[]>;

	getDonation(id: string): Promise<Donation | null>;
	createDonation(donation: Donation): Promise<Donation>;
	updateDonation(donation: Donation): Promise<Donation>;

	listDonationSlots(): Promise<DonationSlot[]>;
	getDonationSlot(id: string): Promise<DonationSlot | null>;
	updateDonationSlot(slot: DonationSlot): Promise<DonationSlot>;
}
