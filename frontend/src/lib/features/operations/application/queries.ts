import { createQuery, createMutation, useQueryClient, type QueryClient } from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import type { AuthorContext } from '$lib/db/model';
import { operationsRepository, shelterDb } from '../data/operations.pouch';
import type { DonationCampaign, CampaignInput } from '../domain/operations';

export const operationsKeys = {
    all: ['operations'] as const,
    campaigns: () => [...operationsKeys.all, 'campaigns'] as const,
    stockLedgers: () => [...operationsKeys.all, 'stockLedgers'] as const,
    donations: () => [...operationsKeys.all, 'donations'] as const
};

/** Reactively fetch all campaigns using TanStack query. */
export const useCampaigns = () =>
    createQuery(() => ({
        queryKey: operationsKeys.campaigns(),
        queryFn: () => operationsRepository().listCampaigns()
    }));

/** Reactively fetch stock ledger entries using TanStack query. */
export const useStockLedgers = () =>
    createQuery(() => ({
        queryKey: operationsKeys.stockLedgers(),
        queryFn: () => operationsRepository().listStockLedgers()
    }));

/** Reactively fetch all donations using TanStack query. */
export const useDonations = () =>
    createQuery(() => ({
        queryKey: operationsKeys.donations(),
        queryFn: () => operationsRepository().listDonations()
    }));

/** Mutation helper to create a new campaign/special request. */
export const useCreateCampaign = () => {
    const queryClient = useQueryClient();
    return createMutation(() => ({
        mutationFn: ({ input, ctx }: { input: CampaignInput; ctx: AuthorContext }) =>
            operationsRepository().createCampaign(input, ctx),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: operationsKeys.campaigns() });
        }
    }));
};

/** Mutation helper to update an existing campaign (e.g. manually closing or opening it). */
export const useUpdateCampaign = () => {
    const queryClient = useQueryClient();
    return createMutation(() => ({
        mutationFn: (campaign: DonationCampaign) =>
            operationsRepository().updateCampaign(campaign),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: operationsKeys.campaigns() });
        }
    }));
};

/**
 * Watch PouchDB's changes feed for the local shelter database. When any operational
 * doc (campaign, stock_ledger, or donation) changes, invalidate relevant query keys
 * to force reactive re-fetches in Svelte.
 */
export function startOperationsLiveQuery(queryClient: QueryClient): LiveQueryHandle {
    return startLiveQuery(shelterDb(), queryClient, (type) => {
        if (type === 'donation_campaign') {
            return [operationsKeys.campaigns(), [...operationsKeys.all, 'campaigns']];
        }
        if (type === 'stock_ledger') {
            return [operationsKeys.stockLedgers(), [...operationsKeys.all, 'stockLedgers']];
        }
        if (type === 'donation') {
            return [operationsKeys.donations(), [...operationsKeys.all, 'donations']];
        }
        return [];
    });
}
