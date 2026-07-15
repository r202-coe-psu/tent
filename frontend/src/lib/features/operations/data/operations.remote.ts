import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterCode, getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import {
	createCampaign as buildCampaign,
	isDonationCampaign,
	isStockLedger,
	isDonation,
	isDonationSlot,
	stockBalance,
	createReceiveEntry,
	createDistributeEntry,
	createTransfer as buildTransfer,
	dispatchTransfer as computeDispatchTransfer,
	receiveTransfer as computeReceiveTransfer,
	isStockTransfer,
	type DonationCampaign,
	type CampaignInput,
	type StockLedger,
	type ReceiveInput,
	type DistributeInput,
	type Donation,
	type DonationSlot,
	type StockTransfer,
	type TransferInput
} from '../domain/operations';
import { createAuditEntry, type AuditAction } from '$lib/features/shared';
import type { OperationsRepository } from './operations.repository';
import { supplyRepository, type SupplyItem } from '$lib/features/supply';
import { qtyAbs, qtyGte } from '$lib/utils/qty';

export function assertReceiveAgainstCatalog(entry: StockLedger, item: SupplyItem | null): void {
	if (!item) {
		throw new Error(
			`Unknown item: ${entry.item_id} — item must exist in the catalog before receiving stock`
		);
	}
	if (item.unit !== entry.unit) {
		throw new Error(
			`Unit mismatch for item ${entry.item_id}: expected ${item.unit}, got ${entry.unit}`
		);
	}
	if (item.perishable && !entry.lot?.expiry) {
		throw new Error(`Perishable item ${entry.item_id} requires lot.expiry to be set`);
	}
}

export class OperationsRemoteRepository implements OperationsRepository {
	private readonly repo: Repository;

	constructor(dbName: string = getShelterDb()) {
		this.repo = createRemoteRepository(dbName);
	}

	// --- Ledger Methods ---

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		return this.repo.put(entry);
	}

	async listLedger(): Promise<StockLedger[]> {
		return this.repo.allByType('stock_ledger', isStockLedger);
	}

	async listLedgerByItem(itemId: string): Promise<StockLedger[]> {
		const ledger = await this.listLedger();
		return ledger.filter((entry) => entry.item_id === itemId);
	}

	async getBalance(): Promise<Map<string, string>> {
		const ledger = await this.listLedger();
		return stockBalance(ledger);
	}

	async receiveStock(input: ReceiveInput, ctx: AuthorContext): Promise<StockLedger> {
		const entry = createReceiveEntry(input, ctx);
		const item = await supplyRepository().getItem(entry.item_id);
		assertReceiveAgainstCatalog(entry, item);
		return this.addLedgerEntry(entry);
	}

	async distributeStock(input: DistributeInput, ctx: AuthorContext): Promise<StockLedger> {
		const entry = createDistributeEntry(input, ctx);

		// WARNING (C-1): This read-then-write is not atomic. Concurrent distributes
		// may both pass the balance check before either write lands, potentially
		// causing negative stock. Acceptable for single-user shelter scenario;
		// tracked for future hardening.
		const balances = await this.getBalance();
		const currentQty = balances.get(entry.item_id) ?? '0';
		const requestedQty = qtyAbs(entry.qty);

		if (!qtyGte(currentQty, requestedQty)) {
			throw new Error(
				`Insufficient stock for item ${entry.item_id} (requested ${requestedQty}, have ${currentQty})`
			);
		}
		return this.addLedgerEntry(entry);
	}

	// --- Inter-shelter Transfer Methods ---

	async createTransfer(input: TransferInput, ctx: AuthorContext): Promise<StockTransfer> {
		const transfer = buildTransfer(input, ctx);
		return this.repo.put(transfer);
	}

	async dispatchTransfer(
		transfer: StockTransfer,
		ctx: AuthorContext
	): Promise<{ transfer: StockTransfer; ledgers: StockLedger[] }> {
		const { transfer: updatedTransfer, ledgers } = computeDispatchTransfer(transfer, ctx);

		// WARNING (C-1): Same accepted risk as distributeStock — this read-then-write
		// is not atomic. Concurrent dispatches may both pass the balance check before
		// either write lands, potentially causing negative stock. Acceptable for
		// single-user shelter scenario; tracked for future hardening.
		const balances = await this.getBalance();
		for (const item of updatedTransfer.items) {
			const currentQty = balances.get(item.item_id) ?? '0';
			const requestedQty = qtyAbs(item.qty);
			if (!qtyGte(currentQty, requestedQty)) {
				throw new Error(
					`Insufficient stock for item ${item.item_id} (requested ${requestedQty}, have ${currentQty})`
				);
			}
		}

		const savedTransfer = await this.repo.put(updatedTransfer);
		const savedLedgers = await Promise.all(ledgers.map((l) => this.repo.put(l)));

		return { transfer: savedTransfer, ledgers: savedLedgers };
	}

	async receiveTransfer(
		transfer: StockTransfer,
		receivedItems: { item_id: string; qty: string | number }[],
		ctx: AuthorContext
	): Promise<{ transfer: StockTransfer; ledgers: StockLedger[] }> {
		const { transfer: updatedTransfer, ledgers } = computeReceiveTransfer(
			transfer,
			receivedItems,
			ctx
		);

		const savedTransfer = await this.repo.put(updatedTransfer);
		const savedLedgers = await Promise.all(ledgers.map((l) => this.repo.put(l)));

		return { transfer: savedTransfer, ledgers: savedLedgers };
	}

	async listIncomingTransfers(): Promise<StockTransfer[]> {
		const transfers = await this.repo.allByType('stock_transfer', isStockTransfer);
		const shelterCode = getShelterCode();
		return transfers.filter((t) => t.to_shelter === shelterCode && t.status === 'shipped');
	}

	// --- Campaign/Donation/Slot Methods ---

	/** Fetch all donation campaigns from this shelter database. */
	async listCampaigns(): Promise<DonationCampaign[]> {
		return this.repo.allByType('donation_campaign', isDonationCampaign);
	}

	/** Get a single donation campaign by ID. */
	async getCampaign(id: string): Promise<DonationCampaign | null> {
		return this.repo.get<DonationCampaign>(id);
	}

	/** Create a campaign from input and persist it. */
	async createCampaign(input: CampaignInput, ctx: AuthorContext): Promise<DonationCampaign> {
		return this.repo.put(buildCampaign(input, ctx));
	}

	/** Persist updates to a campaign (bumps updated_at timestamp). */
	async updateCampaign(
		campaign: DonationCampaign,
		auditInput?: { action: AuditAction; reason: string; ctx: AuthorContext }
	): Promise<DonationCampaign> {
		// Read-Modify-Write: Fetch the latest _rev from the database to prevent 409 conflict
		const existing = await this.repo.get<DonationCampaign>(campaign._id);
		const merged = {
			...campaign,
			_rev: existing?._rev ?? undefined
		};

		const updated = await this.repo.put(touch(merged));
		if (auditInput) {
			const audit = createAuditEntry(
				{
					action: auditInput.action,
					target_type: 'donation_campaign',
					target_id: campaign._id,
					reason: auditInput.reason
				},
				auditInput.ctx
			);
			await this.repo.put(audit);
		}

		return updated;
	}

	/** Fetch all donations in this shelter. */
	async listDonations(): Promise<Donation[]> {
		return this.repo.allByType('donation', isDonation);
	}

	/** Fetch a single donation by ID. */
	async getDonation(id: string): Promise<Donation | null> {
		return this.repo.get<Donation>(id);
	}

	/** Create and persist a new donation. */
	async createDonation(donation: Donation): Promise<Donation> {
		return this.repo.put(donation);
	}

	/** Update an existing donation (bumps updated_at and handles CouchDB MVCC). */
	async updateDonation(donation: Donation): Promise<Donation> {
		const existing = await this.repo.get<Donation>(donation._id);
		const merged = {
			...donation,
			_rev: existing?._rev ?? donation._rev
		};
		return this.repo.put(touch(merged));
	}

	/** Fetch all donation slots from this shelter. */
	async listDonationSlots(): Promise<DonationSlot[]> {
		return this.repo.allByType('donation_slot', isDonationSlot);
	}

	/** Fetch a single donation slot by ID. */
	async getDonationSlot(id: string): Promise<DonationSlot | null> {
		return this.repo.get<DonationSlot>(id);
	}

	/** Create or update a donation slot. */
	async updateDonationSlot(slot: DonationSlot): Promise<DonationSlot> {
		const existing = await this.repo.get<DonationSlot>(slot._id);
		const merged = {
			...slot,
			_rev: existing?._rev ?? slot._rev
		};
		return this.repo.put(touch(merged));
	}
}

let singleton: OperationsRepository | null = null;
let singletonDbName: string | null = null;

export function operationsRepository(): OperationsRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new OperationsRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
