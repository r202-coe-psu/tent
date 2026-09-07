import { createQuery } from '@tanstack/svelte-query';
import { unassignedRegistrationRemote } from '../data/unassigned-registration.remote';
import {
	formatOpenMemberName,
	isOnlineRequiredError,
	type UnassignedRegistrationSearchHit
} from '../domain/search';

export { formatOpenMemberName, isOnlineRequiredError };
export type { UnassignedRegistrationSearchHit };
export { UnassignedRegistrationApiError } from '../data/unassigned-registration.remote';

export const unassignedRegistrationKeys = {
	all: ['unassigned-registration'] as const,
	search: (q: string) => [...unassignedRegistrationKeys.all, 'search', q] as const
};

/** Staff online search of open Unassigned Registrations (Mongo queue). */
export function useUnassignedRegistrationSearch(getQuery: () => string) {
	return createQuery(() => {
		const q = getQuery().trim();
		return {
			queryKey: unassignedRegistrationKeys.search(q),
			queryFn: () => unassignedRegistrationRemote.searchOpen(q),
			enabled: q.length > 0,
			retry: false
		};
	});
}
