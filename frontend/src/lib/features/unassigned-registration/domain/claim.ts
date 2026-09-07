/**
 * Unassigned Registration claim types (CR-113 / #247).
 * Staff ticks open members → Couch birth at pre_registered.
 */

import type { OpenMemberHit } from './search';

export interface UnassignedRegistrationClaimRequest {
	member_ids: string[];
	shelter_code?: string;
}

export interface ClaimedMemberOut {
	reserved_evacuee_id: string;
	status: 'claimed';
	first_name: string;
	last_name: string;
}

export interface UnassignedRegistrationClaimResponse {
	success: boolean;
	id: string | null;
	deleted: boolean;
	shelter_code: string;
	household_id: string;
	evacuee_ids: string[];
	claimed: ClaimedMemberOut[];
	remaining_open: OpenMemberHit[];
}

/** Prefer selecting every open member by default when opening a claim sheet. */
export function defaultSelectedMemberIds(openMembers: readonly OpenMemberHit[]): string[] {
	return openMembers.map((m) => m.reserved_evacuee_id);
}

export function toggleMemberSelection(
	selected: readonly string[],
	memberId: string,
	checked: boolean
): string[] {
	if (checked) {
		return selected.includes(memberId) ? [...selected] : [...selected, memberId];
	}
	return selected.filter((id) => id !== memberId);
}
