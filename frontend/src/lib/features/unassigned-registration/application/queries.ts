import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { peopleKeys } from '$lib/features/people';
import { unassignedRegistrationRemote } from '../data/unassigned-registration.remote';
import type { UnassignedRegistrationClaimRequest } from '../domain/claim';
import {
	CLAIM_DIALOG_DESCRIPTION,
	CLAIM_FLOW_STATUS_GUIDANCE,
	UNASSIGNED_QUEUE_BADGE_LABEL,
	UNASSIGNED_QUEUE_BADGE_SHORT,
	formatClaimCreatedAt,
	formatOpenMemberDemographicsLine,
	formatOpenMemberIdentityLine,
	formatOpenMemberName,
	formatOpenMemberVulnerableGroup,
	formatOpenPetLabel,
	isOnlineRequiredError,
	type UnassignedRegistrationSearchHit
} from '../domain/search';
import {
	unassignedHouseholdToUnifiedInput,
	unassignedMemberToUnifiedMember,
	unassignedPhotoUrl,
	type UnassignedRegistrationReview
} from '../domain/review';

export {
	CLAIM_DIALOG_DESCRIPTION,
	CLAIM_FLOW_STATUS_GUIDANCE,
	UNASSIGNED_QUEUE_BADGE_LABEL,
	UNASSIGNED_QUEUE_BADGE_SHORT,
	formatClaimCreatedAt,
	formatOpenMemberDemographicsLine,
	formatOpenMemberIdentityLine,
	formatOpenMemberName,
	formatOpenMemberVulnerableGroup,
	formatOpenPetLabel,
	isOnlineRequiredError,
	unassignedHouseholdToUnifiedInput,
	unassignedMemberToUnifiedMember,
	unassignedPhotoUrl
};
export type { UnassignedRegistrationSearchHit, UnassignedRegistrationReview };
export { UnassignedRegistrationApiError } from '../data/unassigned-registration.remote';
export { pickReportInEvacueeId, toggleMemberSelection, togglePetSelection } from '../domain/claim';
export type {
	UnassignedRegistrationClaimRequest,
	UnassignedRegistrationClaimResponse
} from '../domain/claim';

export const unassignedRegistrationKeys = {
	all: ['unassigned-registration'] as const,
	search: (q: string) => [...unassignedRegistrationKeys.all, 'search', q] as const,
	review: (id: string) => [...unassignedRegistrationKeys.all, 'review', id] as const
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

/**
 * Claim ticked open members/pets into the caller's shelter (Couch birth).
 *
 * CR-140 addendum: this is step 1 of the review page's confirm sequence, not a
 * standalone user action anymore — the combined "รับเข้าศูนย์สำเร็จ" toast fires from
 * the review page's confirm handler only after Report-in (or, for a pets-only claim,
 * this mutation alone) also succeeds. No success toast here to avoid firing it early.
 */
export function useClaimUnassignedRegistration() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			registrationId,
			payload
		}: {
			registrationId: string;
			payload: UnassignedRegistrationClaimRequest;
		}) => unassignedRegistrationRemote.claimMembers(registrationId, payload),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: unassignedRegistrationKeys.all });
			// Claim births Couch SoR — refresh Station 1 shelter queue.
			queryClient.invalidateQueries({ queryKey: peopleKeys.all });
		},
		onError: (error) => {
			const message = error instanceof Error ? error.message : 'รับสมาชิกเข้าศูนย์ไม่สำเร็จ';
			toast.error(message);
		}
	}));
}

/** Read-only pre-claim review (CR-140 addendum) — Mongo queue data, writes nothing. */
export function useUnassignedRegistrationReview(getId: () => string) {
	return createQuery(() => {
		const id = getId();
		return {
			queryKey: unassignedRegistrationKeys.review(id),
			queryFn: () => unassignedRegistrationRemote.getReview(id),
			enabled: id.length > 0,
			retry: false
		};
	});
}
