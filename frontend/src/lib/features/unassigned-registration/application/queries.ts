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
	isOnlineRequiredError
};
export type { UnassignedRegistrationSearchHit };
export { UnassignedRegistrationApiError } from '../data/unassigned-registration.remote';
export { pickReportInEvacueeId, toggleMemberSelection, togglePetSelection } from '../domain/claim';
export type {
	UnassignedRegistrationClaimRequest,
	UnassignedRegistrationClaimResponse
} from '../domain/claim';

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

/** Claim ticked open members into the caller's shelter (Couch birth). */
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
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: unassignedRegistrationKeys.all });
			// Claim births Couch SoR — refresh Station 1 shelter queue.
			queryClient.invalidateQueries({ queryKey: peopleKeys.all });
			const peopleCount = result.evacuee_ids.length;
			const petCount = result.claimed_pets.length;
			const remaining =
				result.remaining_open.length + (result.remaining_open_pets?.length ?? 0);
			const parts: string[] = [];
			if (peopleCount > 0) parts.push(`${peopleCount} คน`);
			if (petCount > 0) parts.push(`${petCount} สัตว์`);
			const claimedLabel = parts.join(' · ') || 'รายการ';
			toast.success(
				remaining > 0
					? `รับเข้าศูนย์ ${claimedLabel} — รายการที่เหลือยังอยู่ในคิวกลาง`
					: `รับเข้าศูนย์ ${claimedLabel} สำเร็จ — เอกสารคิวกลางเก็บเป็นประวัติ (ไม่ลบ)`
			);
		},
		onError: (error) => {
			const message = error instanceof Error ? error.message : 'รับสมาชิกเข้าศูนย์ไม่สำเร็จ';
			toast.error(message);
		}
	}));
}
