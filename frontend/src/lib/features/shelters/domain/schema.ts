import { z } from 'zod';

// ===== Enums (CR-008) =====

export const operationStatusSchema = z.enum(['standby', 'active', 'full_capacity', 'closed']);
export type OperationStatus = z.infer<typeof operationStatusSchema>;

export const zoneTypeSchema = z.enum([
	'general',
	'male',
	'female',
	'vulnerable',
	'pet',
	'quarantine'
]);
export type ZoneType = z.infer<typeof zoneTypeSchema>;

export const zoneStatusSchema = z.enum(['active', 'closed']);
export type ZoneStatus = z.infer<typeof zoneStatusSchema>;

export const powerSourceSchema = z.enum(['city_grid', 'generator', 'solar']);
export type PowerSource = z.infer<typeof powerSourceSchema>;

export const waterSourceSchema = z.enum(['city_water', 'water_tank', 'groundwater']);
export type WaterSource = z.infer<typeof waterSourceSchema>;

export const communicationChannelSchema = z.enum(['cellular', 'wifi', 'vhf_radio']);
export type CommunicationChannel = z.infer<typeof communicationChannelSchema>;

export const subStorageTypeSchema = z.enum([
	'general',
	'food_dry',
	'drinking_water',
	'medical_supplies'
]);
export type SubStorageType = z.infer<typeof subStorageTypeSchema>;

// ===== Atomic schemas =====

export const locationSchema = z
	.object({
		address: z.string().trim().nullish(),
		lat: z.coerce.number().min(-90).max(90).nullish(),
		lng: z.coerce.number().min(-180).max(180).nullish()
	})
	.optional();
export type Location = z.infer<typeof locationSchema>;

export const contactSchema = z
	.object({
		name: z.string().trim().nullish(),
		phone: z.string().trim().nullish()
	})
	.optional();
export type Contact = z.infer<typeof contactSchema>;

// ===== Facilities (per-shelter, per image section 3b) =====

export const facilitiesSchema = z.object({
	toilets_male: z.coerce.number().int().min(0).nullish(),
	toilets_female: z.coerce.number().int().min(0).nullish(),
	toilets_accessible: z.coerce.number().int().min(0).nullish(),
	showers: z.coerce.number().int().min(0).nullish(),
	water_points: z.coerce.number().int().min(0).nullish(),
	handwashing_stations: z.coerce.number().int().min(0).nullish(),
	car_toilet_accessible: z.boolean().nullish(),
	// CR-023 FR-23-6/7 — supported mobile toilets, gated on car_toilet_accessible (UI hides+clears).
	car_toilet_supported: z.coerce.number().int().min(0).nullish()
});
export type Facilities = z.infer<typeof facilitiesSchema>;

// ===== Common areas (per-shelter, per image section 3c) =====

export const subStorageItemSchema = z.object({
	id: z.string().optional(),
	name: z.string().trim().min(1, 'ชื่อสถานที่จัดเก็บต้องไม่ว่าง'),
	type: subStorageTypeSchema,
	// CR-023 FR-23-11
	area_m2: z.coerce.number().min(0).nullish()
});
export type SubStorageItem = z.infer<typeof subStorageItemSchema>;

export const commonAreasSchema = z.object({
	central_kitchen: z.boolean().nullish(),
	helipad: z.boolean().nullish(),
	parking_capacity: z.coerce.number().int().min(0).nullish(),
	sub_storage: z.array(subStorageItemSchema).optional().default([]),
	// CR-023 FR-23-8/9/10
	isolation_room: z.boolean().nullish(),
	women_child_friendly_space: z.boolean().nullish(),
	logistics_area_m2: z.coerce.number().min(0).nullish()
});
export type CommonAreas = z.infer<typeof commonAreasSchema>;

// ===== Utilities (per-shelter, per image section 4) =====

export const utilitiesBaseSchema = z.object({
	power_source: powerSourceSchema.nullish(),
	water_source: waterSourceSchema.nullish(),
	communications: z.array(communicationChannelSchema).optional().default([]),
	vhf_channel: z.string().trim().nullish().default(null)
});

export const utilitiesSchema = utilitiesBaseSchema.refine(
	(u) => !(u.vhf_channel && u.vhf_channel.length > 0 && !u.communications.includes('vhf_radio')),
	{
		message: 'ต้องเลือก VHF ในระบบสื่อสารก่อนระบุช่องสัญญาณ',
		path: ['vhf_channel']
	}
);
export type Utilities = z.infer<typeof utilitiesSchema>;

// ===== Risk (per-shelter, per image section 5 — EOC use case) =====

export const riskSchema = z.object({
	elevation_m: z.coerce.number().min(0).nullish(),
	entrance_description: z.string().trim().nullish(),
	constraints: z.string().trim().nullish(),
	// CR-023 FR-23-12
	secondary_muster_point: z.string().trim().nullish()
});
export type Risk = z.infer<typeof riskSchema>;

// ===== Zone (extended per CR-008) =====

export const zoneSchema = z.object({
	code: z.string().trim().min(1, 'รหัสโซน (Zone ID) ต้องไม่ว่าง'),
	name: z.string().trim().min(1, 'ชื่อโซนต้องไม่ว่าง'),
	capacity: z.coerce.number().int().positive('ความจุของโซนต้องมากกว่า 0'),
	type: zoneTypeSchema.default('general'),
	status: zoneStatusSchema.default('active'),
	closed_at: z.string().datetime().nullish().default(null),
	closed_by: z.string().nullish().default(null),
	reopened_at: z.string().datetime().nullish().default(null),
	reopened_by: z.string().nullish().default(null),
	reason: z.string().nullish().default(null),
	// CR-023 FR-23-4/5
	area_m2: z.coerce.number().min(0).nullish(),
	specifics: z.string().trim().nullish()
});
export type Zone = z.infer<typeof zoneSchema>;

// ===== CR-023 v4 — enums (section 1/2) =====

/** Building/space type — hardcoded enum (CR-023 FR-23-0d). */
export const areaTypeSchema = z.enum(['indoor', 'outdoor', 'hybrid']);
export type AreaType = z.infer<typeof areaTypeSchema>;

/** Shelter tier — hardcoded enum (CR-023 FR-23-1). */
export const projectLevelSchema = z.enum(['community', 'lao', 'provincial']);
export type ProjectLevel = z.infer<typeof projectLevelSchema>;

/** Key personnel per shelter (CR-023 FR-23-2/3). */
export const keyPersonContactSchema = z.object({
	name: z.string().trim().nullish(),
	phone: z.string().trim().nullish()
});
export type KeyPersonContact = z.infer<typeof keyPersonContactSchema>;

export const keyPersonnelSchema = z.object({
	eoc_liaison: keyPersonContactSchema.nullish(),
	medical_lead: keyPersonContactSchema.nullish(),
	kitchen_lead: keyPersonContactSchema.nullish()
});
export type KeyPersonnel = z.infer<typeof keyPersonnelSchema>;

// ===== CR-023 section 6 — Admission & pet policy (v4.1 nested pet) =====

/** Pet categories allowed when policy = conditional (CR-023 Addendum A FR-23-21). */
export const petCategorySchema = z.enum(['small_general', 'large_dog', 'livestock']);
export type PetCategory = z.infer<typeof petCategorySchema>;

/**
 * Per-category condition whitelists (CR-023 Addendum A, D-A2 revised —
 * differentiated per category instead of one shared 5-item list).
 */
export const smallGeneralConditionSchema = z.enum([
	'bring_own_cage',
	'caged_or_leashed',
	'vaccine_book',
	'owner_hygiene',
	'closed_system_only'
]);
export type SmallGeneralCondition = z.infer<typeof smallGeneralConditionSchema>;

export const largeDogConditionSchema = z.enum([
	'muzzle_and_leash',
	'designated_zone_only',
	'vaccine_book_mandatory',
	'aggressive_behavior_expel_right'
]);
export type LargeDogCondition = z.infer<typeof largeDogConditionSchema>;

export const livestockConditionSchema = z.enum([
	'owner_provides_feed',
	'tethered_designated_area_only'
]);
export type LivestockCondition = z.infer<typeof livestockConditionSchema>;

/** Union of all per-category conditions — for generic label-lookup helpers only; runtime validation is per-category via the discriminated union below. */
export type PetCondition = SmallGeneralCondition | LargeDogCondition | LivestockCondition;

const smallGeneralEntrySchema = z.object({
	category: z.literal('small_general'),
	conditions: z.array(smallGeneralConditionSchema).optional().default([]),
	other: z.string().trim().nullish()
});
const largeDogEntrySchema = z.object({
	category: z.literal('large_dog'),
	conditions: z.array(largeDogConditionSchema).optional().default([]),
	other: z.string().trim().nullish()
});
/** Livestock adds capacity + location fields not applicable to the other categories. */
const livestockEntrySchema = z.object({
	category: z.literal('livestock'),
	max_capacity: z.number().int().nonnegative().nullish(),
	location: z.string().trim().nullish(),
	conditions: z.array(livestockConditionSchema).optional().default([]),
	other: z.string().trim().nullish()
});

export const petCategoryEntrySchema = z.discriminatedUnion('category', [
	smallGeneralEntrySchema,
	largeDogEntrySchema,
	livestockEntrySchema
]);
export type PetCategoryEntry = z.infer<typeof petCategoryEntrySchema>;

/** Nested pet policy — supersedes flat enum[] of CR-023 core (Addendum A FR-23-20/23). */
export const petPolicySchema = z.object({
	policy: z.enum(['no_pets', 'conditional']).nullish(),
	categories: z.array(petCategoryEntrySchema).optional().default([])
});
export type PetPolicy = z.infer<typeof petPolicySchema>;

export const admissionPolicySchema = z.object({
	// master_data:vulnerable_group codes (CR-023 FR-23-14, Option A)
	supported_vulnerable_groups: z.array(z.string()).optional().default([]),
	pet_policy: petPolicySchema.optional().default({ policy: null, categories: [] })
});
export type AdmissionPolicy = z.infer<typeof admissionPolicySchema>;

// ===== CR-023 section 7 — Valuables & luggage policy (Addendum A) =====

/** Standard luggage/property rules — hardcoded whitelist (Appendix C.2). */
export const luggageRuleSchema = z.enum([
	'valuables_self_responsibility',
	'no_hazardous_items',
	'no_large_appliances',
	'has_temp_storage_service'
]);
export type LuggageRule = z.infer<typeof luggageRuleSchema>;

export const luggagePolicySchema = z.object({
	limitation: z.enum(['no_limit', 'limited']).nullish(),
	// gated on limitation === 'limited' (UI hides+clears)
	max_per_family: z.coerce.number().int().min(0).nullish(),
	rules: z.array(luggageRuleSchema).optional().default([]),
	rules_other: z.string().trim().nullish()
});
export type LuggagePolicy = z.infer<typeof luggagePolicySchema>;

// ===== CR-023 section 8 — Vehicle & parking policy (Addendum A) =====

export const vehicleTypeSchema = z.enum(['motorcycle', 'car', 'truck', 'boat']);
export type VehicleType = z.infer<typeof vehicleTypeSchema>;

/** Parking rules — hardcoded whitelist (Appendix C.3). */
export const parkingRuleSchema = z.enum([
	'no_liability',
	'first_come_first_served',
	'key_deposit_required',
	'no_blocking_emergency_lane',
	'ev_emergency_charging'
]);
export type ParkingRule = z.infer<typeof parkingRuleSchema>;

export const supportedVehicleSchema = z.object({
	type: vehicleTypeSchema,
	max_capacity: z.coerce.number().int().min(0).nullish()
});
export type SupportedVehicle = z.infer<typeof supportedVehicleSchema>;

export const parkingPolicySchema = z.object({
	availability: z.enum(['none', 'available']).nullish(),
	// cleared to [] when availability !== 'available' (FR-23-30, D-A5)
	supported_vehicles: z.array(supportedVehicleSchema).optional().default([]),
	rules: z.array(parkingRuleSchema).optional().default([]),
	rules_other: z.string().trim().nullish()
});
export type ParkingPolicy = z.infer<typeof parkingPolicySchema>;

// ===== Main shelter schemas (CR-008 + CR-023 v4/v4.1) =====

export const shelterSchema = z.object({
	name: z.string().trim().min(1, 'ชื่อศูนย์พักพิงต้องไม่ว่าง'),
	operation_status: operationStatusSchema.default('standby'),
	// code จาก master_data:shelter_type (CR-023 FR-23-0a) — persist string code
	shelter_type: z.string().trim().nullish(),
	project_level: projectLevelSchema.nullish(),
	location: locationSchema.optional(),
	contact: contactSchema.optional(),
	// Structured address (CR-023 FR-23-0b/0c, CR-011 style)
	municipality_zone: z.string().trim().nullish(),
	community: z.string().trim().nullish(),
	address_no: z.string().trim().nullish(),
	village_no: z.string().trim().nullish(),
	subdistrict: z.string().trim().nullish(),
	district: z.string().trim().nullish(),
	province: z.string().trim().nullish(),
	postal_code: z.string().trim().nullish(),
	key_personnel: keyPersonnelSchema.nullish(),
	capacity: z.coerce.number().int().positive('ความจุสูงสุดต้องมากกว่า 0'),
	area_m2: z.coerce.number().min(0).nullish(),
	area_type: areaTypeSchema.nullish(),
	facilities: facilitiesSchema,
	common_areas: commonAreasSchema,
	utilities: utilitiesSchema,
	risk: riskSchema,
	zones: z.array(zoneSchema),
	admission_policy: admissionPolicySchema
		.optional()
		.default({ supported_vulnerable_groups: [], pet_policy: { policy: null, categories: [] } }),
	luggage_policy: luggagePolicySchema
		.optional()
		.default({ limitation: null, max_per_family: null, rules: [], rules_other: null }),
	parking_policy: parkingPolicySchema
		.optional()
		.default({ availability: null, supported_vehicles: [], rules: [], rules_other: null })
});
export type Shelter = z.infer<typeof shelterSchema>;

// ===== Server-side create (server auto-mints code) =====

export const createShelterSchema = shelterSchema;
export type CreateShelterInput = Shelter;

// ===== Server-side update (partial PATCH body) =====

export const updateShelterSchema = shelterSchema.partial();
export type UpdateShelterInput = z.infer<typeof updateShelterSchema>;

// ===== v2 → current migration helper =====

export interface ShelterMasterV2 {
	_id: string;
	_rev?: string;
	type: 'shelter';
	schema_v: number;
	code: string;
	name: string;
	zones?: Array<{
		code: string;
		name: string;
		capacity: number;
	}>;
	items?: unknown;
	rules?: unknown;
	sops?: unknown;
	status: string;
	capacity?: number;
	area_m2?: number | null;
	facilities?: {
		toilets_female?: number;
		toilets_male?: number;
		toilets_accessible?: number;
		showers?: number;
		water_points?: number;
		handwashing_stations?: number;
	};
	location?: { address?: string; lat?: number; lng?: number };
	contact?: { name?: string; phone?: string };
	created_at: string;
	updated_at: string;
}

export interface ShelterMaster {
	_id: string;
	_rev?: string;
	type: 'shelter';
	schema_v: 4;
	code: string;
	name: string;
	operation_status?: OperationStatus;
	shelter_type?: string | null;
	project_level?: ProjectLevel | null;
	capacity?: number;
	area_m2?: number | null;
	area_type?: AreaType | string | null;
	// Structured address (CR-023 v4)
	municipality_zone?: string | null;
	community?: string | null;
	address_no?: string | null;
	village_no?: string | null;
	subdistrict?: string | null;
	district?: string | null;
	province?: string | null;
	postal_code?: string | null;
	key_personnel?: KeyPersonnel | null;
	facilities?: {
		toilets_male?: number | null;
		toilets_female?: number | null;
		toilets_accessible?: number | null;
		showers?: number | null;
		water_points?: number | null;
		handwashing_stations?: number | null;
		car_toilet_accessible?: boolean | null;
		car_toilet_supported?: number | null;
	};
	common_areas?: CommonAreas;
	utilities?: {
		power_source?: PowerSource | null;
		water_source?: WaterSource | null;
		communications?: CommunicationChannel[];
		vhf_channel?: string | null;
	};
	risk?: {
		elevation_m?: number | null;
		entrance_description?: string | null;
		constraints?: string | null;
		secondary_muster_point?: string | null;
	};
	zones?: Zone[];
	admission_policy?: AdmissionPolicy;
	luggage_policy?: LuggagePolicy;
	parking_policy?: ParkingPolicy;
	location?: { address?: string | null; lat?: number | null; lng?: number | null };
	contact?: { name?: string | null; phone?: string | null };
	edge_url?: string | null;
	opened_at?: string;
	closed_at?: string | null;
	created_at: string;
	updated_at: string;
}

/** Default-fill for CR-023 v4 policy objects — used by migration + read paths. */
export const EMPTY_ADMISSION_POLICY: AdmissionPolicy = {
	supported_vulnerable_groups: [],
	pet_policy: { policy: null, categories: [] }
};
export const EMPTY_LUGGAGE_POLICY: LuggagePolicy = {
	limitation: null,
	max_per_family: null,
	rules: [],
	rules_other: null
};
export const EMPTY_PARKING_POLICY: ParkingPolicy = {
	availability: null,
	supported_vehicles: [],
	rules: [],
	rules_other: null
};

/** v3 → v4 default-fill (CR-023). Additive: fills new optional fields on read. */
function migrateV3ToV4(v3: ShelterMaster): ShelterMaster {
	return {
		...v3,
		schema_v: 4 as const,
		project_level: v3.project_level ?? null,
		municipality_zone: v3.municipality_zone ?? null,
		community: v3.community ?? null,
		address_no: v3.address_no ?? null,
		village_no: v3.village_no ?? null,
		subdistrict: v3.subdistrict ?? null,
		district: v3.district ?? null,
		province: v3.province ?? null,
		postal_code: v3.postal_code ?? null,
		key_personnel: v3.key_personnel ?? null,
		facilities: {
			...v3.facilities,
			car_toilet_supported: v3.facilities?.car_toilet_supported ?? null
		},
		common_areas: {
			central_kitchen: v3.common_areas?.central_kitchen ?? null,
			helipad: v3.common_areas?.helipad ?? null,
			parking_capacity: v3.common_areas?.parking_capacity ?? null,
			sub_storage: (v3.common_areas?.sub_storage ?? []).map((s) => ({
				...s,
				area_m2: s.area_m2 ?? null
			})),
			isolation_room: v3.common_areas?.isolation_room ?? null,
			women_child_friendly_space: v3.common_areas?.women_child_friendly_space ?? null,
			logistics_area_m2: v3.common_areas?.logistics_area_m2 ?? null
		},
		risk: {
			...v3.risk,
			secondary_muster_point: v3.risk?.secondary_muster_point ?? null
		},
		zones: (v3.zones ?? []).map((z) => ({
			...z,
			area_m2: z.area_m2 ?? null,
			specifics: z.specifics ?? null
		})),
		admission_policy: v3.admission_policy ?? { ...EMPTY_ADMISSION_POLICY },
		luggage_policy: v3.luggage_policy ?? { ...EMPTY_LUGGAGE_POLICY },
		parking_policy: v3.parking_policy ?? { ...EMPTY_PARKING_POLICY }
	};
}

/** Idempotent v2 → current migration. Safe to call multiple times. */
export function migrateShelterV2ToCurrent(master: ShelterMasterV2 | ShelterMaster): ShelterMaster {
	if (master.schema_v >= 4) return master as ShelterMaster;
	if (master.schema_v === 3) return migrateV3ToV4(master as ShelterMaster);
	const v2 = master as ShelterMasterV2;
	// Backfill shelter capacity: v2 stored capacity at the top level but v3 zones
	// are the source of truth, so sum zone capacity (>= 0) and fall back to 100
	// when there are no zones (a single empty shelter shouldn't display 0).
	const zoneSum = (v2.zones ?? []).reduce(
		(sum, z) => sum + (Number.isFinite(z.capacity) ? z.capacity : 0),
		0
	);
	const backfilledCapacity =
		typeof v2.capacity === 'number' && v2.capacity > 0 ? v2.capacity : zoneSum > 0 ? zoneSum : 100;
	const v3 = {
		...v2,
		schema_v: 3 as const,
		operation_status:
			v2.status === 'open' ? ('active' as OperationStatus) : (v2.status as OperationStatus),
		shelter_type: null,
		area_type: null,
		capacity: backfilledCapacity,
		facilities: {
			toilets_male: v2.facilities?.toilets_male ?? null,
			toilets_female: v2.facilities?.toilets_female ?? null,
			toilets_accessible: v2.facilities?.toilets_accessible ?? null,
			showers: v2.facilities?.showers ?? null,
			water_points: v2.facilities?.water_points ?? null,
			handwashing_stations: v2.facilities?.handwashing_stations ?? null,
			car_toilet_accessible: null
		},
		common_areas: {
			central_kitchen: null,
			helipad: null,
			parking_capacity: null,
			sub_storage: []
		},
		utilities: {
			power_source: null,
			water_source: null,
			communications: [],
			vhf_channel: null
		},
		risk: {
			elevation_m: null,
			entrance_description: null,
			constraints: null
		},
		zones: (v2.zones ?? []).map((z) => ({
			...z,
			type: 'general' as ZoneType,
			status: 'active' as ZoneStatus,
			closed_at: null,
			closed_by: null,
			reopened_at: null,
			reopened_by: null,
			reason: null
		}))
	};
	// v2-only fields are not part of v3 — drop them rather than carry dead data.
	delete (v3 as Record<string, unknown>).status;
	delete (v3 as Record<string, unknown>).items;
	delete (v3 as Record<string, unknown>).rules;
	delete (v3 as Record<string, unknown>).sops;
	// Chain v2→v3→v4 so a v2 doc lands on the current shape in one call.
	return migrateV3ToV4(v3 as unknown as ShelterMaster);
}
