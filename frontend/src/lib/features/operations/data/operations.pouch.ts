import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { SHELTER_CODE, SHELTER_DB, shelterDb as _shelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import {
	createCampaign as buildCampaign,
	isDonationCampaign,
	isStockLedger,
	isDonation,
	isDonationSlot,
	stockBalance,
	createReceiveEntry,
	type DonationCampaign,
	type CampaignInput,
	type StockLedger,
	type ReceiveInput,
	type Donation,
	type DonationSlot
} from '../domain/operations';
import { createAuditEntry, type AuditAction } from '$lib/features/shared';
import type { OperationsRepository } from './operations.repository';
import { supplyRepository, type SupplyItem } from '$lib/features/supply';

export { SHELTER_CODE, SHELTER_DB };

/**
 * Validates a receive entry against its catalog item before it's written to the
 * ledger. Pulled out of `receiveStock` so the invariant is testable directly
 * (plain inputs, no PouchDB) and easy to find when `item_master` eventually
 * replaces `supply_item` (CR-013).
 */
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

/**
 * PouchDB-backed repository implementation for Operations (Stock, Campaigns, Donations, Slots).
 */
export class OperationsPouchRepository implements OperationsRepository {
	private readonly repo: Repository;

	constructor(dbName: string = SHELTER_DB) {
		this.repo = createRepository(namedLocalDb(dbName));
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

	async getBalance(): Promise<Map<string, number>> {
		const ledger = await this.listLedger();
		return stockBalance(ledger);
	}

	async receiveStock(input: ReceiveInput, ctx: AuthorContext): Promise<StockLedger> {
		const entry = createReceiveEntry(input, ctx);
		const item = await supplyRepository().getItem(entry.item_id);
		assertReceiveAgainstCatalog(entry, item);
		return this.addLedgerEntry(entry);
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

/**
 * Singleton accessor for the operations repository.
 */
export function operationsRepository(): OperationsRepository {
	if (!singleton) singleton = new OperationsPouchRepository();
	return singleton;
}

export const shelterDb = _shelterDb;
