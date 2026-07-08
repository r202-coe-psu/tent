import type { QueryClient } from '@tanstack/svelte-query';
import { getShelterDb } from '$lib/db/shelter';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { sopRatioKeys } from './queries';

export function startSopRatioLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	const catalogHandle = subscribeDataChanges(queryClient, 'catalog', (type) => {
		return type === 'sop_profile' ? [sopRatioKeys.all] : [];
	});

	const shelterHandle = subscribeDataChanges(queryClient, getShelterDb, (type) => {
		return type === 'sop_override' ? [sopRatioKeys.all] : [];
	});

	return {
		stop: () => {
			catalogHandle.stop();
			shelterHandle.stop();
		}
	};
}
