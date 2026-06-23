import { namedLocalDb } from "$lib/db/pouch";
import { createRepository, type Repository } from "$lib/db/repository";
import { touch, type AuthorContext } from "$lib/db/model";
import {
    createCampaign as buildCampaign,
    isDonationCampaign,
    isStockLedger,
    isDonation,
    type DonationCampaign,
    type CampaignInput,
    type StockLedger,
    type Donation
} from '../domain/operations';
import type { OperationsRepository } from "./operations.repository";

export const SHELTER_CODE = 'SH001';
export const SHELTER_DB = `shelter_${SHELTER_CODE.toLowerCase()}`;

/**
 * PouchDB-backed repository for the operations feature (stock, campaigns, donations).
 * Handles direct database access and parses types through the base Repository helper.
 */
export class OperationsPouchRepository implements OperationsRepository {
    private readonly repo: Repository;

    constructor(dbName: string = SHELTER_DB) {
        this.repo = createRepository(namedLocalDb(dbName));
    }
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
        return this.repo.put(touch(campaign));
    }

    /** Fetch all stock ledger logs in this shelter. */
    async listStockLedgers(): Promise<StockLedger[]> {
        return this.repo.allByType('stock_ledger', isStockLedger);
    }

    /** Fetch all donations in this shelter. */
    async listDonations(): Promise<Donation[]> {
        return this.repo.allByType('donation', isDonation);
    }

}

let singleton: OperationsRepository | null = null;

/** Memoized access to the operations repository instance. */
export function operationsRepository(): OperationsRepository {
    if (!singleton) singleton = new OperationsPouchRepository();
    return singleton;
}
/** Local handle to the PouchDB instance for operations changes listener. */
export function shelterDb(): PouchDB.Database {
    return namedLocalDb(SHELTER_DB);
}
