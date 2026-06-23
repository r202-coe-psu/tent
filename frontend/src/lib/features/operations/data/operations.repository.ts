import type { AuthorContext } from '$lib/db/model';
import type {
    DonationCampaign,
    CampaignInput,
    StockLedger,
    Donation
} from '../domain/operations';


/**
 * Persistence contract for the `operations` feature (stock, campaigns, donations).
 * Allows UI and query layers to query and mutate data independent of specific PouchDB API shapes.
 */

export interface OperationsRepository {
    /** Retrieve all campaigns in this shelter database. */
    listCampaigns(): Promise<DonationCampaign[]>;
    /** Retrieve a single campaign by ID. */
    getCampaign(id: string): Promise<DonationCampaign | null>;
    /** Persist a new campaign. */
    createCampaign(input: CampaignInput, ctx: AuthorContext): Promise<DonationCampaign>;
    /** Update a campaign (LWW: updates status, title, etc). */
    updateCampaign(campaign: DonationCampaign): Promise<DonationCampaign>;
    /** Retrieve all stock ledger entries in this shelter database. */
    listStockLedgers(): Promise<StockLedger[]>;
    /** Retrieve all donations in this shelter database. */
    listDonations(): Promise<Donation[]>;
}