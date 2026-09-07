import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import { unassignedRegistrationRemote } from '../data/unassigned-registration.remote';
import type { UnassignedRegistrationClaimRequest } from '../domain/claim';
import {
	formatOpenMemberName,
	isOnlineRequiredError,
	type UnassignedRegistrationSearchHit
} from '../domain/search';

export { formatOpenMemberName, isOnlineRequiredError };
export type { UnassignedRegistrationSearchHit };
export { UnassignedRegistrationApiError } from '../data/unassigned-registration.remote';
export { defaultSelectedMemberIds, toggleMemberSelection } from '../domain/claim';
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
			const count = result.evacuee_ids.length;
			toast.success(
				result.deleted
					? `รับเข้าศูนย์ ${count} คน — เอกสารคิวถูกลบแล้ว`
					: `รับเข้าศูนย์ ${count} คน — สมาชิกที่เหลือยังอยู่ในคิวกลาง`
			);
		},
		onError: (error) => {
			const message = error instanceof Error ? error.message : 'รับสมาชิกเข้าศูนย์ไม่สำเร็จ';
			toast.error(message);
		}
	}));
}
