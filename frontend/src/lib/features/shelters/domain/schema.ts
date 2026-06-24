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
	car_toilet_accessible: z.boolean().nullish()
});
export type Facilities = z.infer<typeof facilitiesSchema>;

// ===== Common areas (per-shelter, per image section 3c) =====

export const subStorageItemSchema = z.object({
	name: z.string().trim().min(1, 'ชื่อสถานที่จัดเก็บต้องไม่ว่าง'),
	type: subStorageTypeSchema
});
export type SubStorageItem = z.infer<typeof subStorageItemSchema>;

export const commonAreasSchema = z.object({
	central_kitchen: z.boolean().nullish(),
	helipad: z.boolean().nullish(),
	parking_capacity: z.coerce.number().int().min(0).nullish(),
	sub_storage: z.array(subStorageItemSchema).optional().default([])
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
	constraints: z.string().trim().nullish()
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
	reason: z.string().nullish().default(null)
});
export type Zone = z.infer<typeof zoneSchema>;

// ===== Main shelter schemas (CR-008) =====

export const shelterSchema = z.object({
	name: z.string().trim().min(1, 'ชื่อศูนย์พักพิงต้องไม่ว่าง'),
	operation_status: operationStatusSchema.default('standby'),
	shelter_type: z.string().trim().nullish(),
	location: locationSchema.optional(),
	contact: contactSchema.optional(),
	capacity: z.coerce.number().int().positive('ความจุสูงสุดต้องมากกว่า 0'),
	area_m2: z.coerce.number().min(0).nullish(),
	area_type: z.string().trim().nullish(),
	facilities: facilitiesSchema,
	common_areas: commonAreasSchema,
	utilities: utilitiesSchema,
	risk: riskSchema,
	zones: z.array(zoneSchema)
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
	schema_v: 3;
	code: string;
	name: string;
	operation_status?: OperationStatus;
	shelter_type?: string | null;
	capacity?: number;
	area_m2?: number | null;
	area_type?: string | null;
	facilities?: {
		toilets_male?: number | null;
		toilets_female?: number | null;
		toilets_accessible?: number | null;
		showers?: number | null;
		water_points?: number | null;
		handwashing_stations?: number | null;
		car_toilet_accessible?: boolean | null;
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
	};
	zones?: Zone[];
	location?: { address?: string | null; lat?: number | null; lng?: number | null };
	contact?: { name?: string | null; phone?: string | null };
	edge_url?: string | null;
	opened_at?: string;
	closed_at?: string | null;
	created_at: string;
	updated_at: string;
}

/** Idempotent v2 → current migration. Safe to call multiple times. */
export function migrateShelterV2ToCurrent(master: ShelterMasterV2 | ShelterMaster): ShelterMaster {
	if (master.schema_v >= 3) return master as ShelterMaster;
	const v2 = master as ShelterMasterV2;
	return {
		...v2,
		schema_v: 3,
		operation_status: v2.status === 'open' ? 'active' : (v2.status as OperationStatus),
		shelter_type: null,
		area_type: null,
		capacity: v2.capacity ?? 0,
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
			reason: null
		}))
	} as unknown as ShelterMaster;
}
