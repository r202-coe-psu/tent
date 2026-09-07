/**
 * Staff Unassigned Registration feature — search open Mongo queue (CR-113 / #245).
 * Cross-feature / route code imports ONLY from here.
 */

export type {
	OpenMemberHit,
	OpenMemberStatus,
	PersonIdHit,
	UnassignedRegistrationSearchHit,
	UnassignedRegistrationSearchResponse
} from './domain/search';

export { formatOpenMemberName, isOnlineRequiredError } from './domain/search';

export { searchUnassignedRegistrations, UnassignedRegistrationApiError } from './data/staff-api';

export { unassignedRegistrationKeys, useUnassignedRegistrationSearch } from './application/queries';

export { default as UnassignedQueueSearchPanel } from './ui/unassigned-queue-search-panel.svelte';
