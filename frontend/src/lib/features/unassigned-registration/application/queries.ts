import { createQuery } from '@tanstack/svelte-query';
import { searchUnassignedRegistrations } from '../data/staff-api';

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
			queryFn: () => searchUnassignedRegistrations(q),
			enabled: q.length > 0,
			retry: false
		};
	});
}
