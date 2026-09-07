/**
 * Unassigned Registration claim types (CR-113 / #247).
 * Staff ticks open members → Couch birth at pre_registered.
 */

import { z } from 'zod';

export interface UnassignedRegistrationClaimRequest {
	member_ids: string[];
	shelter_code?: string;
}

const personIdHitSchema = z.object({
	cardType: z.enum(['national_id', 'passport', 'pink_card', 'other', 'anonymous']),
	number: z.string().nullable()
});

const openMemberHitSchema = z.object({
	reserved_evacuee_id: z.string(),
	status: z.literal('open'),
	first_name: z.string(),
	last_name: z.string(),
	gender: z.string(),
	phone: z.string().nullable(),
	person_id: personIdHitSchema.nullable(),
	country: z.string(),
	vulnerable_groups: z.array(z.string()),
	special_needs: z.array(z.string())
});

const claimedMemberOutSchema = z.object({
	reserved_evacuee_id: z.string(),
	status: z.literal('claimed'),
	first_name: z.string(),
	last_name: z.string()
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
	remaining_open: z.array(openMemberHitSchema)
});

export type ClaimedMemberOut = z.infer<typeof claimedMemberOutSchema>;
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
