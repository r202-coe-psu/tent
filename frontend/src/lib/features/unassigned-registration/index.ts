/**
 * Staff Unassigned Registration feature — search + claim Mongo queue (CR-113).
 * Cross-feature / route code imports ONLY from here.
 */

export type {
	OpenMemberHit,
	OpenMemberStatus,
	PersonIdHit,
	UnassignedRegistrationSearchHit,
	UnassignedRegistrationSearchResponse
} from './domain/search';

export type {
	ClaimedMemberOut,
	UnassignedRegistrationClaimRequest,
	UnassignedRegistrationClaimResponse
} from './domain/claim';

export {
	UNASSIGNED_QUEUE_BADGE_LABEL,
	UNASSIGNED_QUEUE_BADGE_SHORT,
	formatOpenMemberName,
	isOnlineRequiredError
} from './domain/search';
export {
	pickReportInEvacueeId,
	toggleMemberSelection,
	unassignedRegistrationClaimResponseSchema
} from './domain/claim';

export type { UnassignedRegistrationRepository } from './data/unassigned-registration.repository';
export {
	searchUnassignedRegistrations,
	UnassignedRegistrationApiError,
	unassignedRegistrationRemote
} from './data/unassigned-registration.remote';

export {
	unassignedRegistrationKeys,
	useClaimUnassignedRegistration,
	useUnassignedRegistrationSearch
} from './application/queries';

export { default as UnassignedQueueSearchPanel } from './ui/unassigned-queue-search-panel.svelte';
