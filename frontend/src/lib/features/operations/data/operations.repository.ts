import type { AuthorContext } from '$lib/db/model';
import type {
	DonationCampaign,
	CampaignInput,
	StockLedger,
	ReceiveInput,
	DistributeInput,
	AdjustInput,
	Donation,
	WalkInDonationInput,
	DonationSlot,
	Purchase,
	PurchaseInput,
	CountedItem
} from '../domain/operations';
import type { AuditAction } from '$lib/features/shared';

/**
 * Persistence contract for the `operations` feature (stock, campaigns, donations).
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
	getBalance(): Promise<Map<string, string>>;

	/**
	 * Process and persist an inbound stock receive entry.
	 */
	receiveStock(input: ReceiveInput, ctx: AuthorContext): Promise<StockLedger>;

	/**
	 * Receive goods that arrived without a booking (CR-055 R4 / D-1).
	 *
	 * Mints the walk-in donation document and the ledger row that points at it in
	 * a SINGLE request. They must not be split into two user actions: a donation
	 * written on its own stays `status: 'declared'` if the receipt never follows,
	 * and `calculateReserved` counts every declared donation as reserved stock
	 * with nothing to sweep it (`expireDonation` has no caller).
	 */
	receiveWalkInDonation(
		donationInput: WalkInDonationInput,
		receiveInput: ReceiveInput,
		ctx: AuthorContext
	): Promise<{ donation: Donation; entry: StockLedger }>;

	/**
	 * Process and persist an outbound stock distribute entry.
	 * Will throw an error if there is insufficient stock.
	 */
	distributeStock(input: DistributeInput, ctx: AuthorContext): Promise<StockLedger>;

	/**
	 * Process and persist a stock adjustment entry (increases or decreases stock).
	 */
	adjustStock(input: AdjustInput, ctx: AuthorContext): Promise<StockLedger>;

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

	// Purchase methods (CR-032) — procurement is a two-step flow, mirroring
	// donation: the doc is declared first, the physical count is keyed later.

	/** Persist a new procurement record. Creates no stock on its own. */
	createPurchase(input: PurchaseInput, ctx: AuthorContext): Promise<Purchase>;

	listPurchases(): Promise<Purchase[]>;
	getPurchase(id: string): Promise<Purchase | null>;

	/**
	 * Correct a purchase that has not been keyed against yet. Rejects once any
	 * ledger row references it — `items` is what the receipt status compares
	 * against (schema.md §2.16). There is no cancel/delete.
	 */
	updatePurchase(purchase: Purchase): Promise<Purchase>;

	/**
	 * Key a physical count against an already-committed purchase: appends one
	 * `purchase` ledger entry per counted line, each referencing the purchase doc.
	 * Returns the entries written.
	 */
	receivePurchase(
		purchase: Purchase,
		counted: CountedItem[],
		ctx: AuthorContext
	): Promise<StockLedger[]>;
}
