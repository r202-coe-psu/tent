/**
 * Staff pre-claim review (CR-140 addendum) — read-only Mongo → UnifiedRegistrationForm mapping.
 * Claim + Couch birth happen only when staff confirm on the review page, not when
 * ClaimDialog's checkboxes are ticked (that step only selects `member_ids`/`pet_ids`).
 */

import { z } from 'zod';
import type { UnifiedHouseholdInput, UnifiedMemberWithMeta } from '$lib/features/people';
import { openMemberHitSchema, openPetHitSchema, type OpenMemberHit } from './search';

export const unassignedRegistrationReviewSchema = z.object({
	id: z.string(),
	reserved_household_id: z.string(),
	registered_via: z.enum(['web', 'staff']),
	status: z.string(),
	created_at: z.string(),
	housing_type: z.string().nullable().optional(),
	residence_landmark: z.string().nullable().optional(),
	dorm_name: z.string().nullable().optional(),
	dorm_building: z.string().nullable().optional(),
	dorm_floor: z.string().nullable().optional(),
	dorm_room: z.string().nullable().optional(),
	address_no: z.string().nullable().optional(),
	village_no: z.string().nullable().optional(),
	subdistrict: z.string().nullable().optional(),
	district: z.string().nullable().optional(),
	province: z.string().nullable().optional(),
	postal_code: z.string().nullable().optional(),
	label: z.string().nullable().optional(),
	open_members: z.array(openMemberHitSchema),
	open_pets: z.array(openPetHitSchema).default([])
});

export type UnassignedRegistrationReview = z.infer<typeof unassignedRegistrationReviewSchema>;

/** Staff-only BFF proxy for a GridFS photo — safe to use directly as an `<img src>`. */
export function unassignedPhotoUrl(photoId: string | null | undefined): string | null {
	if (!photoId) return null;
	return `/api/staff/v1/unassigned-registrations/photos/${encodeURIComponent(photoId)}`;
}

const KNOWN_GENDERS = new Set(['male', 'female', 'other']);

function asMemberGender(gender: string): 'male' | 'female' | 'other' {
	return KNOWN_GENDERS.has(gender) ? (gender as 'male' | 'female' | 'other') : 'other';
}

type MemberReligion = 'unknown' | 'other' | 'buddhist' | 'muslim' | 'christian';
const KNOWN_RELIGIONS = new Set<string>(['unknown', 'other', 'buddhist', 'muslim', 'christian']);

function asMemberReligion(religion: string | null | undefined): MemberReligion {
	return religion && KNOWN_RELIGIONS.has(religion) ? (religion as MemberReligion) : 'buddhist';
}

/**
 * Maps one open Mongo member into the same card shape the Report-in page fills from
 * Couch evacuees (`evacueeToUnifiedMember`). `reserved_evacuee_id` is minted at
 * pre-registration time and IS the Couch evacuee `_id` claim will birth — safe to use
 * as `_id` here even before claim runs; `submitFamilyReportIn` re-fetches by id, so no
 * `_rev` is needed. `reporting_in` is always true: every member on this page is, by
 * definition, about to report in as part of this same confirm.
 */
export function unassignedMemberToUnifiedMember(member: OpenMemberHit): UnifiedMemberWithMeta {
	return {
		_id: member.reserved_evacuee_id,
		first_name: member.first_name,
		last_name: member.last_name ?? '',
		gender: asMemberGender(member.gender),
		birth_year: member.birth_year ?? undefined,
		age: member.age ?? undefined,
		person_id: member.person_id
			? { cardType: member.person_id.cardType, number: member.person_id.number ?? '' }
			: { cardType: 'national_id', number: '' },
		phone: member.phone ?? null,
		nickname: member.nickname ?? '',
		emergency_contact: member.emergency_contact ?? { name: '', phone: '', relation: '' },
		vulnerable_groups: member.vulnerable_groups ?? [],
		special_needs: member.special_needs ?? [],
		medical_conditions: [],
		medical_allergies: [],
		medical_medications: [],
		medical_note: undefined,
		photo: unassignedPhotoUrl(member.photo),
		country: member.country ?? 'THAILAND',
		religion: asMemberReligion(member.religion),
		religion_other: member.religion_other ?? null,
		disability_other_detail: member.disability_other_detail ?? null,
		// Checked at public submit — an unchanged number skips the checksum again (CR-148 FR-03)
		original_person_number: member.person_id?.number ?? null,
		stay_status: 'pre_registered',
		reporting_in: true,
		zone: null
	};
}

/**
 * Household address block for the form — `pets` intentionally left empty here.
 * Claim (couch_birth) is the single source of truth for what lands in `household.pets[]`;
 * the review page shows open pets as a separate read-only summary (`open_pets`) rather
 * than feeding them through this form section, and re-fetches the post-claim Couch
 * household before calling Report-in so nothing here can clobber what claim just wrote.
 */
export function unassignedHouseholdToUnifiedInput(
	review: UnassignedRegistrationReview
): UnifiedHouseholdInput {
	return {
		housing_type: (review.housing_type as UnifiedHouseholdInput['housing_type']) ?? 'owned_house',
		residence_landmark: review.residence_landmark ?? null,
		dorm_name: review.dorm_name ?? null,
		dorm_building: review.dorm_building ?? null,
		dorm_floor: review.dorm_floor ?? null,
		dorm_room: review.dorm_room ?? null,
		address_no: review.address_no ?? null,
		village_no: review.village_no ?? null,
		subdistrict: review.subdistrict ?? null,
		district: review.district ?? null,
		province: review.province ?? null,
		postal_code: review.postal_code ?? null,
		pets: [],
		vehicles: [],
		assets: null
	};
}
