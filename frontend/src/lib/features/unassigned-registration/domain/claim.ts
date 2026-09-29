/**
 * Unassigned Registration claim types (CR-113 / #247 + draft-persistent-unassigned-family).
 * Staff ticks open members and/or pets → Couch birth at pre_registered.
 */

import { z } from 'zod';
import { openMemberHitSchema, openPetHitSchema } from './search';

export interface UnassignedRegistrationClaimRequest {
	member_ids?: string[];
	pet_ids?: string[];
	shelter_code?: string;
}

const claimedMemberOutSchema = z.object({
	reserved_evacuee_id: z.string(),
	status: z.literal('claimed'),
	first_name: z.string(),
	last_name: z.string()
});

const claimedPetOutSchema = z.object({
	pet_id: z.string(),
	status: z.literal('claimed'),
	species: z.enum(['dog', 'cat', 'other']),
	count: z.number().int().positive()
});

/** Narrow BFF/FastAPI claim success bodies (CONVENTIONS §3 — no `as` at the boundary). */
export const unassignedRegistrationClaimResponseSchema = z.object({
	success: z.boolean(),
	id: z.string().nullable(),
	deleted: z.boolean(),
	shelter_code: z.string(),
	household_id: z.string(),
	evacuee_ids: z.array(z.string()),
	claimed: z.array(claimedMemberOutSchema),
	claimed_pets: z.array(claimedPetOutSchema).default([]),
	remaining_open: z.array(openMemberHitSchema),
	remaining_open_pets: z.array(openPetHitSchema).default([])
});

export type ClaimedMemberOut = z.infer<typeof claimedMemberOutSchema>;
export type ClaimedPetOut = z.infer<typeof claimedPetOutSchema>;
export type UnassignedRegistrationClaimResponse = z.infer<
	typeof unassignedRegistrationClaimResponseSchema
>;

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

/** Alias — same toggle semantics for pet_id checkboxes. */
export const togglePetSelection = toggleMemberSelection;

/**
 * After a successful claim, Station 1 continues into Report-in for the first
 * birthed Couch evacuee (`pre_registered` → `arriving` on Report-in submit).
 * Pets-only claims return null (stay on caller page).
 */
export function pickReportInEvacueeId(
	evacueeIds: readonly string[] | null | undefined
): string | null {
	const first = evacueeIds?.find((id) => typeof id === 'string' && id.trim().length > 0);
	return first?.trim() ?? null;
}
