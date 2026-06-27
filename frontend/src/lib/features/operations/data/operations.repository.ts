import type { AuthorContext } from '$lib/db/model';
import type {
    DonationCampaign,
    CampaignInput,
    StockLedger,
    ReceiveInput,
    Donation,
    DonationSlot
} from '../domain/operations';

/**
 * Persistence contract for the `operations` feature (stock, campaigns, donations).
 * Allows UI and query layers to query and mutate data independent of specific PouchDB API shapes.
 */
export interface OperationsRepository {
    // Ledger methods
    addLedgerEntry(entry: StockLedger): Promise<StockLedger>;
    listLedger(): Promise<StockLedger[]>;
    listLedgerByItem(itemId: string): Promise<StockLedger[]>;
    getBalance(): Promise<Map<string, number>>;
    receiveStock(input: ReceiveInput, ctx: AuthorContext): Promise<StockLedger>;

    // Campaign/Donation/Slot methods
    listCampaigns(): Promise<DonationCampaign[]>;
    getCampaign(id: string): Promise<DonationCampaign | null>;
    createCampaign(input: CampaignInput, ctx: AuthorContext): Promise<DonationCampaign>;
    updateCampaign(campaign: DonationCampaign): Promise<DonationCampaign>;
    listStockLedgers(): Promise<StockLedger[]>;
    listDonations(): Promise<Donation[]>;

    getDonation(id: string): Promise<Donation | null>;
    createDonation(donation: Donation): Promise<Donation>;
    updateDonation(donation: Donation): Promise<Donation>;

    listDonationSlots(): Promise<DonationSlot[]>;
    getDonationSlot(id: string): Promise<DonationSlot | null>;
    updateDonationSlot(slot: DonationSlot): Promise<DonationSlot>;
}
