import type { UnassignedRegistrationSearchResponse } from '../domain/search';
import type {
	UnassignedRegistrationClaimRequest,
	UnassignedRegistrationClaimResponse
} from '../domain/claim';
import type { UnassignedRegistrationReview } from '../domain/review';

/** Staff Unassigned Registration repository — BFF-backed Mongo queue search/claim. */
export interface UnassignedRegistrationRepository {
	searchOpen(q: string): Promise<UnassignedRegistrationSearchResponse>;
	claimMembers(
		registrationId: string,
		payload: UnassignedRegistrationClaimRequest
	): Promise<UnassignedRegistrationClaimResponse>;
	/** Read-only pre-claim review (CR-140 addendum) — writes nothing. */
	getReview(registrationId: string): Promise<UnassignedRegistrationReview>;
}
