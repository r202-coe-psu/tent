/**
 * CouchDB changes subscriber for live TanStack Query cache invalidation.
 */

import type { QueryClient } from '@tanstack/svelte-query';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { getShelterDb } from '$lib/db/shelter';
import { resolveShelterCode } from './shared';
import { distributionKeys } from './keys';

export function startDistributionLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, getShelterDb, (type) => {
		const shelterCode = resolveShelterCode();
		if (type === 'requisition_ticket') {
			return [
				[...distributionKeys.shelter(shelterCode), 'tickets'],
				[...distributionKeys.shelter(shelterCode), 'ticket']
			];
		}
		if (type === 'distribution_log') {
			return [
				[...distributionKeys.shelter(shelterCode), 'logs'],
				[...distributionKeys.shelter(shelterCode), 'log'],
				[...distributionKeys.shelter(shelterCode), 'shift_reconciliation']
			];
		}
		if (type === 'bulk_return_pool') {
			return [
				[...distributionKeys.shelter(shelterCode), 'bulk_pools'],
				[...distributionKeys.shelter(shelterCode), 'bulk_pool']
			];
		}
		if (type === 'bulk_return_claim') {
			return [
				[...distributionKeys.shelter(shelterCode), 'bulk_claims'],
				[...distributionKeys.shelter(shelterCode), 'bulk_claim']
			];
		}
		return [];
	});
}
