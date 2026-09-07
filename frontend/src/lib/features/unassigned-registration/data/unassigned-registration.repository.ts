import type { UnassignedRegistrationSearchResponse } from '../domain/search';

/** Staff Unassigned Registration repository — BFF-backed Mongo queue search. */
export interface UnassignedRegistrationRepository {
	searchOpen(q: string): Promise<UnassignedRegistrationSearchResponse>;
}
