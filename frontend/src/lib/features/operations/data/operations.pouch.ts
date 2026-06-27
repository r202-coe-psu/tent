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
    createStockLedger,
    receiveInputSchema,
    type DonationCampaign,
    type CampaignInput,
    type StockLedger,
    type ReceiveInput,
    type Donation,
    type DonationSlot
} from '../domain/operations';
import type { OperationsRepository } from './operations.repository';

export { SHELTER_CODE, SHELTER_DB };

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
        const d = receiveInputSchema.parse(input);
        const entry = createStockLedger({ ...d, reason: 'receive' }, ctx);
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
    async updateCampaign(campaign: DonationCampaign): Promise<DonationCampaign> {
        // Read-Modify-Write: Fetch the latest _rev from the database to prevent 409 conflict
        const existing = await this.repo.get<DonationCampaign>(campaign._id);
        const merged = {
            ...campaign,
            _rev: existing?._rev ?? campaign._rev
        };
        return this.repo.put(touch(merged));
    }

    /** Fetch all stock ledger logs in this shelter. */
    async listStockLedgers(): Promise<StockLedger[]> {
        return this.repo.allByType('stock_ledger', isStockLedger);
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
