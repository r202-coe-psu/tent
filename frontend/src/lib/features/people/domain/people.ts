import { z } from 'zod';
import {
	type AuthorContext,
	type BaseDoc,
	type Timestamp,
	makeDoc,
	now,
	phoneSchema,
	registeredViaSchema
} from '$lib/db/model';

/**
 * People domain — the registration baseline (FR-4..13).
 *
 * Pure: no PouchDB. Doc interfaces are the persisted shape (envelope +
 * type-specific fields, docs/data/schema.md §1); input schemas are what the UI
 * captures; factories stamp the envelope and apply spec defaults.
 *
 * `movement` and `screening` are append-only — never update or delete an
 * existing one (schema.md §7 rule 2).
 */

// ---------------------------------------------------------------- enums
export const cardTypeSchema = z.enum(['national_id', 'passport', 'pink_card', 'other']);
export type CardType = z.infer<typeof cardTypeSchema>;

export const personIdSchema = z.object({
	cardType: cardTypeSchema.default('national_id'),
	number: z.string().trim().optional()
});
export type PersonId = z.infer<typeof personIdSchema>;

export const genderSchema = z.enum(['male', 'female', 'other']);
export type Gender = z.infer<typeof genderSchema>;

export const religionSchema = z.enum(['buddhist', 'muslim', 'christian', 'other', 'unknown']);
export type Religion = z.infer<typeof religionSchema>;

export const specialNeedSchema = z.enum([
	'elderly',
	'disabled',
	'pregnant',
	'infant',
	'chronic_illness',
	'bedridden'
]);
export type SpecialNeed = z.infer<typeof specialNeedSchema>;

export const stayStatusSchema = z.enum(['registered', 'checked_in', 'checked_out', 'transferred']);
export type StayStatus = z.infer<typeof stayStatusSchema>;

export const householdStatusSchema = z.enum([
	'pre_registered',
	'arriving',
	'checked_in',
	'checked_out',
	'cancelled'
]);
export type HouseholdStatus = z.infer<typeof householdStatusSchema>;

export const checkoutDestinationSchema = z.object({
	type: z.enum(['returned_home', 'transferred_shelter', 'referred_facility', 'other']),
	destination_name: z.string().trim().optional(),
	notes: z.string().trim().optional()
});
export type CheckoutDestination = z.infer<typeof checkoutDestinationSchema>;

export const movementActionSchema = z.enum([
	'check_in',
	'check_out',
	'transfer_out',
	'transfer_in'
]);
export type MovementAction = z.infer<typeof movementActionSchema>;

export const careTrackSchema = z.enum(['normal', 'fast_track']);
export type CareTrack = z.infer<typeof careTrackSchema>;

export const bloodGroupSchema = z.enum(['A', 'B', 'AB', 'O', 'unknown']);
export type BloodGroup = z.infer<typeof bloodGroupSchema>;

// ---------------------------------------------------------------- documents

export interface CurrentStay {
	status: StayStatus;
	zone: string | null;
	since: Timestamp;
}

export interface EmergencyContact {
	name: string;
	phone: string;
	relation: string;
}

export interface Evacuee extends BaseDoc {
	type: 'evacuee';
	first_name: string;
	last_name: string;
	gender: Gender;
	phone: string | null;
	nickname?: string;
	birth_year?: number;
	person_id?: PersonId;
	country: string;
	religion?: Religion;
	special_needs: SpecialNeed[];
	emergency_contact?: EmergencyContact;
	household_id: string | null;
	current_stay: CurrentStay;
	privacy: { search_excluded: boolean };
	registered_via: z.infer<typeof registeredViaSchema>;
	anonymized?: boolean; // set by the purge job
}

export interface Medical extends BaseDoc {
	type: 'medical';
	evacuee_id: string;
	blood_group?: BloodGroup;
	conditions: string[];
	medications: string[];
	allergies: string[];
	track: CareTrack;
	notes?: string;
}

export interface HouseholdAsset {
	description: string;
	image_url: string | null;
}

export interface HouseholdVehicle {
	type: 'car' | 'motorcycle' | 'other';
	license_plate: string | null;
}

export interface PetGroup {
	species: 'dog' | 'cat' | 'bird' | 'other';
	count: number;
	notes?: string;
	has_cage?: boolean;
	image_url?: string | null;
}

export interface Household extends BaseDoc {
	type: 'household';
	label: string;
	head_evacuee_id: string | null;
	status: HouseholdStatus; // CR-029
	checkout_destination: CheckoutDestination | null; // CR-029
	municipality_zone: string | null;
	community: string | null;
	pets: PetGroup[];
	assets?: HouseholdAsset | null;
	vehicles: HouseholdVehicle[];
	notes?: string;
	address_no: string | null;
	village_no: string | null;
	subdistrict: string | null;
	district: string | null;
	province: string | null;
	postal_code: string | null;
}

export interface MovementDestination {
	kind: 'home' | 'shelter' | 'hospital' | 'other';
	shelter_code?: string;
	detail?: string;
}

export interface Movement extends BaseDoc {
	type: 'movement';
	evacuee_id: string;
	action: MovementAction;
	zone: string | null;
	destination?: MovementDestination;
	reason?: string;
	occurred_at: Timestamp;
}

export interface Screening extends BaseDoc {
	type: 'screening';
	evacuee_id: string;
	symptoms: string[];
	temperature_c: number | null;
	track: CareTrack;
	needs_referral: boolean;
	notes?: string;
	screened_at: Timestamp;
}

export type PeopleDoc = Evacuee | Medical | Household | Movement | Screening;

// ---------------------------------------------------------------- input schemas

export const evacueeInputSchema = z.object({
	first_name: z.string().trim().min(1, 'First name is required'),
	last_name: z.string().trim().min(1, 'Last name is required'),
	gender: genderSchema,
	phone: phoneSchema, // UI requires a value; "ไม่มี" → null
	nickname: z.string().trim().optional(),
	birth_year: z.coerce.number().int().optional(),
	person_id: personIdSchema.default({ cardType: 'national_id', number: '' }),
	country: z.string().trim().min(1, 'Country is required').default('THAILAND'),
	religion: religionSchema.default('buddhist'),
	medical_conditions: z.array(z.string().trim().min(1)).default([]),
	medical_allergies: z.array(z.string().trim().min(1)).default([]),
	medical_medications: z.array(z.string().trim().min(1)).default([]),
	medical_note: z.string().trim().optional(),
	track: careTrackSchema.optional(),
	special_needs: z.array(specialNeedSchema).default([]),
	emergency_contact: z
		.object({
			name: z.string().trim().min(1),
			phone: z.string().trim().min(1),
			relation: z.string().trim().min(1)
		})
		.optional(),
	household_id: z.string().nullable().default(null),
	registered_via: registeredViaSchema.default('app')
});
export type EvacueeInput = z.input<typeof evacueeInputSchema>;

export const medicalInputSchema = z.object({
	evacuee_id: z.string().min(1),
	blood_group: bloodGroupSchema.optional(),
	conditions: z.array(z.string().trim().min(1)).default([]),
	medications: z.array(z.string().trim().min(1)).default([]),
	allergies: z.array(z.string().trim().min(1)).default([]),
	track: careTrackSchema.default('normal'),
	notes: z.string().trim().optional()
});
export type MedicalInput = z.input<typeof medicalInputSchema>;

export const householdInputSchema = z.object({
	label: z.string().trim().min(1, 'Label is required'),
	head_evacuee_id: z.string().nullable().default(null),
	status: householdStatusSchema.default('arriving'), // CR-029
	checkout_destination: checkoutDestinationSchema.nullable().default(null), // CR-029
	municipality_zone: z.string().trim().nullable().default(null),
	community: z.string().trim().nullable().default(null),
	pets: z
		.array(
			z.object({
				species: z.enum(['dog', 'cat', 'bird', 'other']),
				count: z.coerce.number().int().positive(),
				notes: z.string().trim().optional(),
				has_cage: z.boolean().optional(),
				image_url: z.string().trim().nullable().optional()
			})
		)
		.default([]),
	assets: z
		.object({
			description: z.string().trim(),
			image_url: z.string().trim().nullable().default(null)
		})
		.nullable()
		.optional(),
	vehicles: z
		.array(
			z.object({
				type: z.enum(['car', 'motorcycle', 'other']),
				license_plate: z.string().trim().nullable().default(null)
			})
		)
		.default([]),
	notes: z.string().trim().optional(),
	address_no: z.string().trim().nullable().default(null),
	village_no: z.string().trim().nullable().default(null),
	subdistrict: z.string().trim().nullable().default(null),
	district: z.string().trim().nullable().default(null),
	province: z.string().trim().nullable().default(null),
	postal_code: z.string().trim().nullable().default(null)
});
export type HouseholdInput = z.input<typeof householdInputSchema>;

export const movementInputSchema = z.object({
	evacuee_id: z.string().min(1),
	action: movementActionSchema,
	zone: z.string().trim().nullable().default(null),
	destination: z
		.object({
			kind: z.enum(['home', 'shelter', 'hospital', 'other']),
			shelter_code: z.string().optional(),
			detail: z.string().trim().optional()
		})
		.optional(),
	reason: z.string().trim().optional(),
	occurred_at: z.string().optional() // defaults to now() in the factory
});
export type MovementInput = z.input<typeof movementInputSchema>;

export const screeningInputSchema = z.object({
	evacuee_id: z.string().min(1),
	symptoms: z.array(z.string().trim().min(1)).default([]),
	temperature_c: z.coerce.number().nullable().default(null),
	track: careTrackSchema,
	needs_referral: z.boolean().default(false),
	notes: z.string().trim().optional(),
	screened_at: z.string().optional()
});
export type ScreeningInput = z.input<typeof screeningInputSchema>;

// ---------------------------------------------------------------- factories

export function createEvacuee(input: EvacueeInput, ctx: AuthorContext): Evacuee {
	const d = evacueeInputSchema.parse(input);
	return makeDoc(
		'evacuee',
		2,
		{
			first_name: d.first_name,
			last_name: d.last_name,
			gender: d.gender,
			phone: d.phone,
			...(d.nickname ? { nickname: d.nickname } : {}),
			...(d.birth_year !== undefined ? { birth_year: d.birth_year } : {}),
			...(d.person_id ? { person_id: d.person_id } : {}),
			...(d.religion ? { religion: d.religion } : {}),
			country: d.country,
			special_needs: d.special_needs,
			...(d.emergency_contact ? { emergency_contact: d.emergency_contact } : {}),
			household_id: d.household_id,
			current_stay: { status: 'registered', zone: null, since: now() },
			privacy: { search_excluded: false },
			registered_via: d.registered_via
		},
		ctx
	);
}

export function createMedical(input: MedicalInput, ctx: AuthorContext): Medical {
	const d = medicalInputSchema.parse(input);
	return makeDoc(
		'medical',
		1,
		{
			evacuee_id: d.evacuee_id,
			...(d.blood_group ? { blood_group: d.blood_group } : {}),
			conditions: d.conditions,
			medications: d.medications,
			allergies: d.allergies,
			track: d.track,
			...(d.notes ? { notes: d.notes } : {})
		},
		ctx
	);
}

export function createHousehold(input: HouseholdInput, ctx: AuthorContext): Household {
	const d = householdInputSchema.parse(input);
	return makeDoc(
		'household',
		4, // ปรับเวอร์ชัน schema_v จาก 3 -> 4 ตาม CR-029
		{
			label: d.label,
			head_evacuee_id: d.head_evacuee_id,
			status: d.status, // CR-029
			checkout_destination: d.checkout_destination, // CR-029
			municipality_zone: d.municipality_zone,
			community: d.community,
			pets: d.pets,
			assets: d.assets || null,
			vehicles: d.vehicles,
			...(d.notes ? { notes: d.notes } : {}),
			address_no: d.address_no || null,
			village_no: d.village_no || null,
			subdistrict: d.subdistrict || null,
			district: d.district || null,
			province: d.province || null,
			postal_code: d.postal_code || null
		},
		ctx
	);
}

export function createMovement(input: MovementInput, ctx: AuthorContext): Movement {
	const d = movementInputSchema.parse(input);
	return makeDoc(
		'movement',
		1,
		{
			evacuee_id: d.evacuee_id,
			action: d.action,
			zone: d.zone,
			...(d.destination ? { destination: d.destination } : {}),
			...(d.reason ? { reason: d.reason } : {}),
			occurred_at: d.occurred_at ?? now()
		},
		ctx
	);
}

export function createScreening(input: ScreeningInput, ctx: AuthorContext): Screening {
	const d = screeningInputSchema.parse(input);
	return makeDoc(
		'screening',
		1,
		{
			evacuee_id: d.evacuee_id,
			symptoms: d.symptoms,
			temperature_c: d.temperature_c,
			track: d.track,
			needs_referral: d.needs_referral,
			...(d.notes ? { notes: d.notes } : {}),
			screened_at: d.screened_at ?? now()
		},
		ctx
	);
}

// ---------------------------------------------------------------- transitions

/**
 * Apply a movement to an evacuee's denormalized `current_stay` snapshot. The
 * authoritative history is the append-only movement stream; this just keeps the
 * UI snapshot in step (movement events win on conflict — data-model.md §5).
 */
export function applyMovementToStay(evacuee: Evacuee, movement: Movement): Evacuee {
	const statusByAction: Record<MovementAction, StayStatus> = {
		check_in: 'checked_in',
		check_out: 'checked_out',
		transfer_out: 'transferred',
		transfer_in: 'checked_in'
	};
	return {
		...evacuee,
		updated_at: now(),
		current_stay: {
			status: statusByAction[movement.action],
			zone: movement.zone ?? evacuee.current_stay.zone,
			since: movement.occurred_at
		}
	};
}

// ---------------------------------------------------------------- display helpers

export const SPECIAL_NEED_CHIPS: Record<SpecialNeed, { emoji: string; label: string }> = {
	elderly: { emoji: '👴', label: 'ผู้สูงอายุ' },
	disabled: { emoji: '♿', label: 'พิการ' },
	pregnant: { emoji: '🤰', label: 'ครรภ์' },
	infant: { emoji: '👶', label: 'เด็กเล็ก' },
	chronic_illness: { emoji: '🩺', label: 'โรคเรื้อรัง' },
	bedridden: { emoji: '🛏️', label: 'ผู้ป่วยติดเตียง' }
} as const;

export function maskNationalId(id: string | null | undefined): string {
	if (!id || id.length < 6) return '—';
	return `${id.slice(0, 3)}***${id.slice(-3)}`;
}

export function zoneLabel(zone: string | null | undefined): string {
	if (!zone) return '—';
	return zone.toUpperCase();
}

// ---------------------------------------------------------------- type guards

export const isEvacuee = (d: unknown): d is Evacuee =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'evacuee';
export const isMedical = (d: unknown): d is Medical =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'medical';
export const isHousehold = (d: unknown): d is Household =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'household';
export const isMovement = (d: unknown): d is Movement =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'movement';
export const isScreening = (d: unknown): d is Screening =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'screening';

export interface EwarSymptom {
	id: string;
	emoji: string;
	label: string;
	sublabel?: string;
}

export interface EwarSymptomGroup {
	title: string;
	symptoms: EwarSymptom[];
}

export const EWAR_SYMPTOM_GROUPS: EwarSymptomGroup[] = [
	{
		title: 'กลุ่มอาการทางเดินอาหาร',
		symptoms: [
			{
				id: 'acute_watery_diarrhea',
				emoji: '💧',
				label: 'อุจจาระร่วงเฉียบพลันแบบเป็นน้ำ/อหิวาตกโรค (Acute watery diarrhoea / Cholera)'
			},
			{
				id: 'acute_bloody_diarrhea',
				emoji: '🩸',
				label: 'ท้องร่วงเป็นเลือด/โรคบิด (Acute bloody diarrhoea / Shigellosis)'
			},
			{
				id: 'typhoid',
				emoji: '🌡️',
				label: 'ไทฟอยด์ (Typhoid)'
			}
		]
	},
	{
		title: 'กลุ่มอาการทางเดินหายใจ',
		symptoms: [
			{
				id: 'acute_respiratory',
				emoji: '😷',
				label: 'การติดเชื้อระบบทางเดินหายใจเฉียบพลัน (Acute respiratory infection)'
			}
		]
	},
	{
		title: 'กลุ่มโรคที่มีพาหะนำโรค',
		symptoms: [
			{
				id: 'malaria',
				emoji: '🤒',
				label: 'ไข้มาลาเรีย (Malaria)'
			},
			{
				id: 'dengue',
				emoji: '🦟',
				label: 'ไข้เลือดออก (Dengue)'
			}
		]
	},
	{
		title: 'กลุ่มโรคติดต่อรุนแรงและไข้ออกผื่น',
		symptoms: [
			{
				id: 'measles',
				emoji: '🔴',
				label: 'โรคหัด (Measles)'
			},
			{
				id: 'meningitis',
				emoji: '🧠',
				label: 'เยื่อหุ้มสมองอักเสบ (Meningitis)'
			},
			{
				id: 'diphtheria',
				emoji: '🗣️',
				label: 'คอตีบ (Diphtheria)'
			},
			{
				id: 'pertussis',
				emoji: '😮‍💨',
				label: 'ไอกรน (Pertussis)'
			}
		]
	},
	{
		title: 'กลุ่มอาการตับอักเสบ',
		symptoms: [
			{
				id: 'acute_jaundice_syndrome',
				emoji: '🟡',
				label: 'ภาวะดีซ่านเฉียบพลัน (Acute Jaundice Syndrome)'
			},
			{
				id: 'Hepatitis A or E',
				emoji: '🦠',
				label: 'ไวรัสตับอักเสบชนิด เอ หรือ อี (Hepatitis A or E)'
			}
		]
	},
	{
		title: 'กลุ่มอาการทางระบบประสาทและอื่นๆ',
		symptoms: [
			{
				id: 'acute_flaccid_paralysis',
				emoji: '🦿',
				label: 'ภาวะกล้ามเนื้ออ่อนปวกเปียกเฉียบพลันหรือโรคโปลิโอ (Acute Flaccid Paralysis / Polio)'
			},
			{
				id: 'tetanus',
				emoji: '🩹',
				label: 'บาดทะยัก (Tetanus)'
			},
			{
				id: 'acute_haemorrhagic_fever_syndrome',
				emoji: '🩸',
				label: 'กลุ่มอาการไข้เลือดออกรุงแรง (Acute Haemorrhagic Fever Syndrome)'
			}
		]
	},
	{
		title: 'อาการเฝ้าระวังทั่วไปและเหตุฉุกเฉินอื่นๆ',
		symptoms: [
			{
				id: 'high_fever',
				emoji: '🔥',
				label: 'อาการไข้สูงกว่า 38.5 องศาเซลเซียส'
			},
			{
				id: 'trauma',
				emoji: '💥',
				label: 'การบาดเจ็บ (Trauma)'
			},
			{
				id: 'chemical_poisoning',
				emoji: '☠️',
				label: 'สารเคมีเป็นพิษ (Chemical Poisoning)'
			}
		]
	}
];
