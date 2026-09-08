/**
 * Unified multi-person family registration (#249).
 *
 * Pure domain: form validation, pet quick-select, anonymous ID apply,
 * and the create plan (1 Household + N Evacuees). No I/O / no Svelte.
 */
import { z } from 'zod';
import {
	autoHouseholdLabel,
	hasMinimumResidence,
	type ResidenceFields
} from './registration-shell';
import {
	evacueeInputSchema,
	formatPersonName,
	housingTypeSchema,
	householdInputSchema,
	isMeaningfulOtherPetNotes,
	mintAnonymousId,
	type EvacueeInput,
	type HouseholdInput,
	type PetGroup
} from './people';

/** UI label for members[0] — maps to `head_evacuee_id` without hierarchical wording. */
export const PRIMARY_CONTACT_LABEL = 'ผู้ติดต่อหลัก';

export type UnifiedRegistrationChannel = 'onsite' | 'public';

const petGroupSchema = z
	.object({
		species: z.enum(['dog', 'cat', 'other']),
		count: z.coerce.number().int().positive().default(1),
		notes: z.string().trim().optional(),
		has_cage: z.boolean().optional(),
		image_url: z.string().trim().nullable().optional()
	})
	.superRefine((pet, ctx) => {
		if (pet.species === 'other' && !isMeaningfulOtherPetNotes(pet.notes)) {
			ctx.addIssue({
				code: 'custom',
				path: ['notes'],
				message: 'กรุณาระบุชนิดสัตว์เมื่อเลือกอื่นๆ'
			});
		}
	});

const vehicleSchema = z.object({
	type: z.enum(['car', 'motorcycle', 'other']),
	license_plate: z.string().trim().nullable().default(null)
});

/**
 * Shared household block for the unified form.
 * Homeless: hide + clear `address_no`; require landmark **or** complete admin geo (#249 / CR-112).
 * Caps on pets/vehicles (20) are intentional UX limits — keep create compensation; do not raise casually.
 */
export const unifiedHouseholdInputSchema = z
	.object({
		housing_type: housingTypeSchema.nullable().optional().default(null),
		residence_landmark: z.string().trim().nullable().optional().default(null),
		address_no: z.string().trim().nullable().optional().default(null),
		village_no: z.string().trim().nullable().optional().default(null),
		subdistrict: z.string().trim().nullable().optional().default(null),
		district: z.string().trim().nullable().optional().default(null),
		province: z.string().trim().nullable().optional().default(null),
		postal_code: z.string().trim().nullable().optional().default(null),
		// Intentional caps (#249): keep createFamilyRegistration compensation; not remove.
		pets: z.array(petGroupSchema).max(20).default([]),
		vehicles: z.array(vehicleSchema).max(20).default([]),
		assets: z
			.object({
				description: z.string().trim(),
				image_url: z.string().trim().nullable().default(null)
			})
			.nullable()
			.optional()
			.default(null)
	})
	.superRefine((household, ctx) => {
		const residence: ResidenceFields = {
			housing_type: household.housing_type,
			residence_landmark: household.residence_landmark,
			address_no: household.housing_type === 'homeless' ? null : household.address_no,
			village_no: household.village_no,
			subdistrict: household.subdistrict,
			district: household.district,
			province: household.province,
			postal_code: household.postal_code
		};

		if (household.housing_type === 'homeless') {
			const landmark = household.residence_landmark?.trim();
			const geoComplete = Boolean(
				household.province?.trim() && household.district?.trim() && household.subdistrict?.trim()
			);
			if (!landmark && !geoComplete) {
				ctx.addIssue({
					code: 'custom',
					path: ['residence_landmark'],
					message: 'ที่พักแบบไร้บ้านเลขที่ต้องมีจุดสังเกตหรือที่ตั้งครบ'
				});
			}
			return;
		}

		if (!hasMinimumResidence(residence)) {
			ctx.addIssue({
				code: 'custom',
				path: ['address_no'],
				message: 'กรุณากรอกบ้านเลขที่ จังหวัด อำเภอ และตำบล'
			});
		}
	})
	.transform((household) =>
		household.housing_type === 'homeless' ? { ...household, address_no: null } : household
	);

/** Equal member card fields — personal + emergency + VG + special needs. */
export const unifiedMemberInputSchema = evacueeInputSchema.omit({
	household_id: true,
	status: true,
	registered_via: true,
	card_snapshot: true,
	track: true
});

export const unifiedRegistrationInputSchema = z.object({
	// Intentional 20-member batch cap (#249): keep create compensation; not a soft warning.
	members: z
		.array(unifiedMemberInputSchema)
		.min(1, 'ต้องมีสมาชิกอย่างน้อย 1 คน')
		.max(20, 'ลงทะเบียนได้สูงสุด 20 คนต่อครั้ง'),
	household: unifiedHouseholdInputSchema
});

export type UnifiedMemberInput = z.input<typeof unifiedMemberInputSchema>;
export type UnifiedHouseholdInput = z.input<typeof unifiedHouseholdInputSchema>;
export type UnifiedRegistrationInput = z.input<typeof unifiedRegistrationInputSchema>;
export type UnifiedRegistrationParsed = z.output<typeof unifiedRegistrationInputSchema>;

export function parseUnifiedRegistration(
	input: UnifiedRegistrationInput
): UnifiedRegistrationParsed {
	return unifiedRegistrationInputSchema.parse(input);
}

export function memberCardLabel(index: number): string {
	return index === 0 ? PRIMARY_CONTACT_LABEL : `สมาชิก ${index + 1}`;
}

export function blankUnifiedMember(): UnifiedMemberInput {
	return {
		first_name: '',
		last_name: '',
		gender: 'other',
		phone: null,
		nickname: '',
		country: 'THAILAND',
		religion: 'unknown',
		person_id: { cardType: 'national_id', number: '' },
		vulnerable_groups: [],
		special_needs: [],
		medical_conditions: [],
		medical_allergies: [],
		medical_medications: [],
		emergency_contact: { name: '', phone: '', relation: '' },
		photo: null
	};
}

/** 「บันทึกเคสไม่มีบัตร / บุคคลนิรนาม」 — mint ANON-{ulid} without blocking submit. */
export function applyAnonymousIdToMember(member: UnifiedMemberInput): UnifiedMemberInput {
	return {
		...member,
		person_id: {
			cardType: 'anonymous',
			number: mintAnonymousId()
		}
	};
}

/**
 * Quick-select pet chips: dog | cat | other(+notes).
 * Toggling an existing species removes it; `other` requires notes when adding.
 */
export function togglePetSpecies(
	pets: readonly PetGroup[],
	species: 'dog' | 'cat' | 'other',
	notes?: string
): PetGroup[] {
	const existing = pets.findIndex((p) => p.species === species);
	if (existing >= 0) {
		return pets.filter((_, i) => i !== existing);
	}
	if (species === 'other') {
		const trimmed = notes?.trim() ?? '';
		if (!isMeaningfulOtherPetNotes(trimmed)) {
			return [...pets, { species: 'other', count: 1, notes: '' }];
		}
		return [...pets, { species: 'other', count: 1, notes: trimmed }];
	}
	return [...pets, { species, count: 1 }];
}

export interface FamilyRegistrationPlan {
	headMemberIndex: 0;
	memberInputs: EvacueeInput[];
	householdInput: HouseholdInput;
}

/**
 * Build the Couch write plan: N Evacuee inputs + 1 Household input.
 * `head_evacuee_id` is filled by the repository after member[0] is persisted.
 */
export function planFamilyRegistration(
	input: UnifiedRegistrationInput,
	channel: UnifiedRegistrationChannel
): FamilyRegistrationPlan {
	const parsed = parseUnifiedRegistration(input);
	const status = channel === 'onsite' ? 'arriving' : 'pre_registered';
	const registered_via = channel === 'onsite' ? 'staff' : 'web';

	const memberInputs: EvacueeInput[] = parsed.members.map((member) => ({
		...member,
		household_id: null,
		status,
		registered_via
	}));

	const head = memberInputs[0]!;
	const householdInput: HouseholdInput = householdInputSchema.parse({
		label: autoHouseholdLabel(formatPersonName(head)),
		head_evacuee_id: null,
		status,
		checkout_destination: null,
		municipality_zone: null,
		community: null,
		pets: parsed.household.pets,
		vehicles: parsed.household.vehicles,
		assets: parsed.household.assets ?? null,
		notes: '',
		housing_type: parsed.household.housing_type ?? null,
		residence_landmark: parsed.household.residence_landmark ?? null,
		address_no:
			parsed.household.housing_type === 'homeless' ? null : (parsed.household.address_no ?? null),
		village_no: parsed.household.village_no ?? null,
		subdistrict: parsed.household.subdistrict ?? null,
		district: parsed.household.district ?? null,
		province: parsed.household.province ?? null,
		postal_code: parsed.household.postal_code ?? null
	});

	return {
		headMemberIndex: 0,
		memberInputs,
		householdInput
	};
}
