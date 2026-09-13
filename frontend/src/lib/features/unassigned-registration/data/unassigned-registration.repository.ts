import type { UnassignedRegistrationSearchResponse } from '../domain/search';
import type {
	UnassignedRegistrationClaimRequest,
	UnassignedRegistrationClaimResponse
} from '../domain/claim';

/** Staff Unassigned Registration repository — BFF-backed Mongo queue search/claim. */
export interface UnassignedRegistrationRepository {
	searchOpen(q: string): Promise<UnassignedRegistrationSearchResponse>;
	claimMembers(
		registrationId: string,
		payload: UnassignedRegistrationClaimRequest
	): Promise<UnassignedRegistrationClaimResponse>;
}
