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
import type { AuthorContext } from '$lib/db/model';
import {
	PETS_MAX_COUNT,
	dormFieldsFor,
	evacueeInputSchema,
	formatPersonName,
	refineDormFields,
	refineMemberRules,
	totalPetCount,
	housingTypeSchema,
	householdInputSchema,
	isMeaningfulOtherPetNotes,
	mintAnonymousId,
	type Evacuee,
	type EvacueeInput,
	type Household,
	type HouseholdInput,
	type PetGroup,
	type StayStatus
} from './people';

/** UI label for members[0] — maps to `head_evacuee_id` without hierarchical wording. */
export const PRIMARY_CONTACT_LABEL = 'ผู้ติดต่อหลัก';

export type UnifiedRegistrationChannel = 'onsite' | 'public';

/** How the unified member card uploads face photos. */
export type MemberPhotoUploadMode = 'none' | 'onsite-couch' | 'unassigned-gridfs' | 'shelter-couch';

const petGroupSchema = z
	.object({
		species: z.enum(['dog', 'cat', 'other']),
		count: z.coerce
			.number()
			.int()
			.positive()
			.max(PETS_MAX_COUNT, `สัตว์เลี้ยงรวมได้ไม่เกิน ${PETS_MAX_COUNT} ตัวต่อครอบครัว`)
			.default(1),
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
 * Caps: vehicles 20 (UX limit, #249); animals ≤ {@link PETS_MAX_COUNT} per household (CR-148).
 * Dorm (`apartment_dorm`): dorm name + room required, `address_no` = composed summary (CR-148).
 */
export const unifiedHouseholdInputSchema = z
	.object({
		housing_type: housingTypeSchema.nullable().optional().default('owned_house'),
		residence_landmark: z.string().trim().nullable().optional().default(null),
		dorm_name: z.string().trim().nullable().optional().default(null),
		dorm_building: z.string().trim().nullable().optional().default(null),
		dorm_floor: z.string().trim().nullable().optional().default(null),
		dorm_room: z.string().trim().nullable().optional().default(null),
		address_no: z.string().trim().nullable().optional().default(null),
		village_no: z.string().trim().nullable().optional().default(null),
		subdistrict: z.string().trim().nullable().optional().default(null),
		district: z.string().trim().nullable().optional().default(null),
		province: z.string().trim().nullable().optional().default(null),
		postal_code: z.string().trim().nullable().optional().default(null),
		// Intentional caps (#249 / CR-148): keep createFamilyRegistration compensation; not remove.
		pets: z.array(petGroupSchema).max(PETS_MAX_COUNT).default([]),
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
		if (totalPetCount(household.pets) > PETS_MAX_COUNT) {
			ctx.addIssue({
				code: 'custom',
				path: ['pets'],
				message: `สัตว์เลี้ยงรวมได้ไม่เกิน ${PETS_MAX_COUNT} ตัวต่อครอบครัว`
			});
		}
		refineDormFields(household, ctx);
		const residence: ResidenceFields = {
			housing_type: household.housing_type,
			residence_landmark: household.residence_landmark,
			address_no: dormFieldsFor(household).address_no,
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
	.transform((household) => ({ ...household, ...dormFieldsFor(household) }));

/** Equal member card fields — personal + emergency + VG + special needs. */
export const unifiedMemberInputSchema = evacueeInputSchema
	.omit({
		household_id: true,
		status: true,
		registered_via: true,
		card_snapshot: true,
		track: true
	})
	.extend({
		/**
		 * Stored `person_id.number` of an existing evacuee (report-in / pull from queue) — an
		 * unchanged number skips the national-ID checksum (CR-148 FR-03). Never persisted.
		 */
		original_person_number: z.string().nullable().optional()
	});

export const unifiedRegistrationInputSchema = z
	.object({
		// Intentional 20-member batch cap (#249): keep create compensation; not a soft warning.
		members: z
			.array(unifiedMemberInputSchema)
			.min(1, 'ต้องมีสมาชิกอย่างน้อย 1 คน')
			.max(20, 'ลงทะเบียนได้สูงสุด 20 คนต่อครั้ง'),
		household: unifiedHouseholdInputSchema,
		/** Staff create paths — join an existing Household by id (onsite / back-office). */
		join_household_id: z.string().trim().min(1).nullable().optional(),
		/**
		 * Public create paths — short-lived signed match token from residence-match BFF.
		 * Server resolves to household / unassigned id; never treat as a Couch id.
		 */
		join_match_token: z.string().trim().min(1).nullable().optional()
	})
	.superRefine((value, ctx) => {
		value.members.forEach((member, index) => refineMemberRules(member, ctx, ['members', index]));
		const hasHh = Boolean(value.join_household_id?.trim());
		const hasToken = Boolean(value.join_match_token?.trim());
		if (hasHh && hasToken) {
			ctx.addIssue({
				code: 'custom',
				path: ['join_match_token'],
				message: 'ระบุได้เพียง join_household_id หรือ join_match_token อย่างใดอย่างหนึ่ง'
			});
		}
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
		// Default: ไม่ระบุเพศ (persisted as null).
		gender: null,
		// '' = not filled in yet (the field opens ready to type); null = "ไม่มีเบอร์" ticked.
		phone: '',
		nickname: '',
		country: 'THAILAND',
		religion: 'unknown',
		// Keep defined — Svelte 5 rejects bind:x={undefined} when $bindable has a fallback.
		religion_other: null,
		disability_other_detail: null,
		preferred_zone: null,
		person_id: { cardType: 'national_id', number: '' },
		vulnerable_groups: [],
		special_needs: [],
		medical_conditions: [],
		medical_allergies: [],
		medical_medications: [],
		emergency_contact: { name: '', phone: '', relation: '' },
		photo: null,
		zone: null
	};
}

/**
 * Members who neither entered a phone nor ticked「ไม่มีเบอร์」. The card keeps
 * `phone === null` only when that box is ticked, so a blank string means no choice
 * was made — the schema would otherwise save it silently as "no phone".
 */
export function membersMissingPhoneChoice(
	members: readonly Pick<UnifiedMemberInput, 'phone'>[]
): number[] {
	return members.flatMap((m, i) =>
		typeof m.phone === 'string' && m.phone.trim() === '' ? [i] : []
	);
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

export type FamilyRegistrationMode = 'create' | 'join';

export interface FamilyRegistrationPlan {
	mode: FamilyRegistrationMode;
	/** Set when `mode === 'join'` — existing Household id (staff) or resolved from token. */
	targetHouseholdId: string | null;
	headMemberIndex: 0;
	memberInputs: EvacueeInput[];
	/**
	 * Create: full new Household input.
	 * Join: pets/vehicles/assets only (append); Residence / label / head are ignored at write.
	 */
	householdInput: HouseholdInput;
}

/**
 * Build the Couch write plan.
 * - **create:** N Evacuee inputs + 1 Household input (`head_evacuee_id` filled after persist).
 * - **join:** N Evacuee inputs linked to `join_household_id`; do not mint Household / overwrite Residence.
 */
export function planFamilyRegistration(
	input: UnifiedRegistrationInput,
	channel: UnifiedRegistrationChannel
): FamilyRegistrationPlan {
	const parsed = parseUnifiedRegistration(input);
	const status = channel === 'onsite' ? 'arriving' : 'pre_registered';
	const registered_via = channel === 'onsite' ? 'staff' : 'web';
	const targetHouseholdId = parsed.join_household_id?.trim() || null;
	const mode: FamilyRegistrationMode = targetHouseholdId ? 'join' : 'create';

	const memberInputs: EvacueeInput[] = parsed.members.map((parsedMember) => {
		// `original_person_number` is form-only meta (CR-148 FR-03) — never persisted
		const member: Partial<typeof parsedMember> = { ...parsedMember };
		delete member.original_person_number;
		return {
			...(member as typeof parsedMember),
			household_id: mode === 'join' ? targetHouseholdId : null,
			// Registration never zones / checks in (ADR-0001): zoning happens at Station 3 only
			zone: null,
			status,
			registered_via
		};
	});

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
		...dormFieldsFor(parsed.household),
		village_no: parsed.household.village_no ?? null,
		subdistrict: parsed.household.subdistrict ?? null,
		district: parsed.household.district ?? null,
		province: parsed.household.province ?? null,
		postal_code: parsed.household.postal_code ?? null
	});

	return {
		mode,
		targetHouseholdId,
		headMemberIndex: 0,
		memberInputs,
		householdInput
	};
}

export type UnifiedMemberWithMeta = UnifiedMemberInput & {
	_id?: string;
	_rev?: string;
	stay_status?: StayStatus;
	reporting_in?: boolean;
};

export interface FamilyReportInPayload {
	householdId: string;
	/** Explicit opt-in for the kiosk flow when no existing household was selected. */
	createHousehold?: boolean;
	household: UnifiedHouseholdInput;
	members: UnifiedMemberWithMeta[];
	ctx: AuthorContext;
	/** Reuse generated document ids when the same report-in is retried. */
	ids?: import('$lib/db/ulid-reservation').UlidReservation;
}

function cleanAreaPrefix(name?: string | null): string {
	if (!name) return '';
	return name.replace(/^(ตำบล|แขวง|อำเภอ|เขต|จังหวัด|ต\.|อ\.|จ\.)/, '').trim();
}

/** Converts an existing CouchDB Household into form-compatible UnifiedHouseholdInput, with optional fallback to smart card snapshot. */
export function householdToUnifiedInput(
	household: Household | null | undefined,
	fallbackEvacuee?: Evacuee | null
): UnifiedHouseholdInput {
	const snap = fallbackEvacuee?.card_snapshot;
	const villageParts = [snap?.village_no, snap?.lane, snap?.road].filter(Boolean).join(' ');

	if (!household) {
		return {
			housing_type: 'owned_house',
			residence_landmark: null,
			address_no: snap?.address_no ?? '',
			village_no: villageParts,
			subdistrict: cleanAreaPrefix(snap?.subdistrict),
			district: cleanAreaPrefix(snap?.district),
			province: cleanAreaPrefix(snap?.province),
			postal_code: snap?.postal_code ?? '',
			pets: [],
			vehicles: [],
			assets: null
		};
	}
	return {
		housing_type: household.housing_type ?? 'owned_house',
		residence_landmark: household.residence_landmark ?? null,
		dorm_name: household.dorm_name ?? null,
		dorm_building: household.dorm_building ?? null,
		dorm_floor: household.dorm_floor ?? null,
		dorm_room: household.dorm_room ?? null,
		address_no: household.address_no ?? snap?.address_no ?? '',
		village_no: household.village_no ?? villageParts,
		subdistrict: household.subdistrict ?? cleanAreaPrefix(snap?.subdistrict),
		district: household.district ?? cleanAreaPrefix(snap?.district),
		province: household.province ?? cleanAreaPrefix(snap?.province),
		postal_code: household.postal_code ?? snap?.postal_code ?? '',
		pets: household.pets ?? [],
		vehicles: household.vehicles ?? [],
		assets: household.assets
			? {
					description: household.assets.description ?? '',
					image_url: household.assets.image_url ?? null
				}
			: null
	};
}

/** Converts an existing CouchDB Evacuee into form-compatible UnifiedMemberWithMeta. */
export function evacueeToUnifiedMember(
	evacuee: Evacuee,
	targetEvacueeId?: string
): UnifiedMemberWithMeta {
	const isTarget = targetEvacueeId ? evacuee._id === targetEvacueeId : true;
	const isPreReg = evacuee.current_stay.status === 'pre_registered';
	return {
		_id: evacuee._id,
		_rev: evacuee._rev,
		first_name: evacuee.first_name,
		last_name: evacuee.last_name ?? '',
		gender: evacuee.gender ?? null,
		birth_year: evacuee.birth_year ?? undefined,
		age: evacuee.age ?? undefined,
		person_id: evacuee.person_id ?? { cardType: 'national_id', number: '' },
		phone: evacuee.phone ?? null,
		nickname: evacuee.nickname ?? '',
		emergency_contact: evacuee.emergency_contact ?? { name: '', phone: '', relation: '' },
		vulnerable_groups: evacuee.vulnerable_groups ?? [],
		special_needs: evacuee.special_needs ?? [],
		medical_conditions: [],
		medical_allergies: [],
		medical_medications: [],
		medical_note: undefined,
		photo: evacuee.photo ?? evacuee.card_snapshot?.photo_base64 ?? null,
		country: evacuee.country ?? 'THAILAND',
		religion: evacuee.religion ?? 'buddhist',
		religion_other: evacuee.religion_other ?? null,
		disability_other_detail: evacuee.disability_other_detail ?? null,
		preferred_zone: evacuee.preferred_zone ?? null,
		original_person_number: evacuee.person_id?.number ?? null,
		stay_status: evacuee.current_stay.status,
		reporting_in: isPreReg && isTarget,
		zone: evacuee.current_stay.zone ?? null
	};
}
