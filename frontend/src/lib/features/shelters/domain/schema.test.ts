import { describe, it, expect } from 'vitest';
import {
	shelterSchema,
	createShelterSchema,
	updateShelterSchema,
	zoneSchema,
	facilitiesSchema,
	commonAreasSchema,
	utilitiesSchema,
	utilitiesBaseSchema,
	riskSchema,
	subStorageItemSchema,
	migrateShelterV2ToCurrent,
	type ShelterMasterV2
} from './schema';

// ===== Test fixtures =====

const validShelterInput = {
	name: 'โรงเรียนบ้านค่าย',
	operation_status: 'standby' as const,
	capacity: 150,
	facilities: {},
	common_areas: {},
	utilities: {},
	risk: {},
	zones: []
};

describe('shelterSchema', () => {
	it('accepts minimal valid shelter', () => {
		const s = shelterSchema.parse(validShelterInput);
		expect(s.name).toBe('โรงเรียนบ้านค่าย');
		expect(s.operation_status).toBe('standby');
		expect(s.capacity).toBe(150);
		expect(s.facilities).toEqual({});
		expect(s.common_areas).toEqual({ sub_storage: [] });
		expect(s.utilities).toEqual({ communications: [], vhf_channel: null });
		expect(s.risk).toEqual({});
		expect(s.zones).toEqual([]);
	});

	it('rejects empty name', () => {
		expect(() => shelterSchema.parse({ ...validShelterInput, name: '  ' })).toThrow();
	});

	it('rejects capacity of 0', () => {
		expect(() => shelterSchema.parse({ ...validShelterInput, capacity: 0 })).toThrow();
	});

	it('rejects negative capacity', () => {
		expect(() => shelterSchema.parse({ ...validShelterInput, capacity: -1 })).toThrow();
	});

	it('coerces capacity from string', () => {
		const s = shelterSchema.parse({ ...validShelterInput, capacity: '200' });
		expect(s.capacity).toBe(200);
	});

	it('rejects invalid operation_status', () => {
		expect(() =>
			shelterSchema.parse({ ...validShelterInput, operation_status: 'invalid' })
		).toThrow();
	});

	it('accepts all 4 operation_status values', () => {
		const statuses = ['standby', 'active', 'full_capacity', 'closed'] as const;
		for (const op of statuses) {
			const s = shelterSchema.parse({ ...validShelterInput, operation_status: op });
			expect(s.operation_status).toBe(op);
		}
	});

	it('accepts lat within range', () => {
		const s = shelterSchema.parse({
			...validShelterInput,
			location: { address: 'test', lat: 7.5, lng: 100.5 }
		});
		expect(s.location?.lat).toBe(7.5);
	});

	it('rejects lat > 90', () => {
		expect(() => shelterSchema.parse({ ...validShelterInput, location: { lat: 91 } })).toThrow();
	});

	it('rejects lat < -90', () => {
		expect(() => shelterSchema.parse({ ...validShelterInput, location: { lat: -91 } })).toThrow();
	});

	it('rejects lng > 180', () => {
		expect(() => shelterSchema.parse({ ...validShelterInput, location: { lng: 181 } })).toThrow();
	});
});

describe('zoneSchema', () => {
	it('accepts minimal zone', () => {
		const z = zoneSchema.parse({ code: 'Z1', name: 'โซน A', capacity: 50 });
		expect(z.type).toBe('general');
		expect(z.status).toBe('active');
		expect(z.closed_at).toBeNull();
		expect(z.closed_by).toBeNull();
		expect(z.reason).toBeNull();
	});

	it('rejects empty code', () => {
		expect(() => zoneSchema.parse({ code: '', name: 'X', capacity: 1 })).toThrow();
	});

	it('rejects zero capacity', () => {
		expect(() => zoneSchema.parse({ code: 'Z1', name: 'X', capacity: 0 })).toThrow();
	});

	it('accepts all 6 zone types', () => {
		const types = ['general', 'male', 'female', 'vulnerable', 'pet', 'quarantine'] as const;
		for (const t of types) {
			const z = zoneSchema.parse({ code: 'Z1', name: 'X', capacity: 10, type: t });
			expect(z.type).toBe(t);
		}
	});
});

describe('facilitiesSchema', () => {
	it('accepts empty object', () => {
		expect(facilitiesSchema.parse({})).toEqual({});
	});
	it('accepts full facilities', () => {
		const f = facilitiesSchema.parse({
			toilets_male: 10,
			toilets_female: 15,
			toilets_accessible: 2,
			showers: 8,
			water_points: 3,
			handwashing_stations: 6,
			car_toilet_accessible: true
		});
		expect(f.car_toilet_accessible).toBe(true);
	});
	it('rejects negative toilet count', () => {
		expect(() => facilitiesSchema.parse({ toilets_male: -1 })).toThrow();
	});
});

describe('commonAreasSchema', () => {
	it('accepts empty object and defaults sub_storage to []', () => {
		const c = commonAreasSchema.parse({});
		expect(c.sub_storage).toEqual([]);
	});

	it('rejects empty sub_storage name', () => {
		expect(() =>
			commonAreasSchema.parse({ sub_storage: [{ name: '', type: 'general' }] })
		).toThrow();
	});

	it('accepts sub_storage items', () => {
		const c = commonAreasSchema.parse({
			sub_storage: [{ name: 'อาหารแห้ง', type: 'food_dry' }]
		});
		expect(c.sub_storage?.[0]?.type).toBe('food_dry');
	});
});

describe('subStorageItemSchema', () => {
	it('rejects empty name', () => {
		expect(() => subStorageItemSchema.parse({ name: '', type: 'general' })).toThrow();
	});
});

describe('utilitiesSchema', () => {
	it('accepts empty utilities', () => {
		expect(utilitiesSchema.parse({})).toEqual({ communications: [], vhf_channel: null });
	});

	it('rejects vhf_channel without vhf_radio in communications', () => {
		expect(() =>
			utilitiesSchema.parse({ communications: ['cellular'], vhf_channel: 'CH-16' })
		).toThrow();
	});

	it('accepts vhf_channel when vhf_radio is in communications', () => {
		const u = utilitiesSchema.parse({
			communications: ['vhf_radio'],
			vhf_channel: 'CH-16'
		});
		expect(u.vhf_channel).toBe('CH-16');
	});

	it('accepts empty vhf_channel', () => {
		const u = utilitiesSchema.parse({ communications: ['cellular'] });
		expect(u.vhf_channel).toBeNull();
	});

	it('utilitiesBaseSchema has no refinement', () => {
		expect(() =>
			utilitiesBaseSchema.parse({ communications: ['cellular'], vhf_channel: 'CH-16' })
		).not.toThrow();
	});
});

describe('riskSchema', () => {
	it('accepts empty object', () => {
		expect(riskSchema.parse({})).toEqual({});
	});
	it('rejects negative elevation', () => {
		expect(() => riskSchema.parse({ elevation_m: -10 })).toThrow();
	});
});

describe('createShelterSchema / updateShelterSchema', () => {
	it('createShelterSchema accepts full shelter', () => {
		const s = createShelterSchema.parse({
			...validShelterInput,
			shelter_type: 'โรงเรียน',
			area_m2: 1200,
			facilities: {
				toilets_male: 10,
				toilets_female: 15,
				toilets_accessible: 2,
				showers: 8,
				car_toilet_accessible: true
			},
			common_areas: {
				central_kitchen: true,
				helipad: false,
				parking_capacity: 30,
				sub_storage: [{ name: 'อาหารแห้ง', type: 'food_dry' }]
			},
			zones: [{ code: 'Z1', name: 'โซน A', capacity: 100, type: 'general' }]
		});
		expect(s.zones).toHaveLength(1);
	});

	it('updateShelterSchema allows partial input', () => {
		const u = updateShelterSchema.parse({ name: 'new name' });
		expect(u.name).toBe('new name');
		expect(u.capacity).toBeUndefined();
	});
});

describe('migrateShelterV2ToCurrent', () => {
	const v2Master: ShelterMasterV2 = {
		_id: 'shelter:test',
		_rev: '1-abc',
		type: 'shelter',
		schema_v: 2,
		code: 'SH001',
		name: 'Test',
		status: 'open',
		zones: [{ code: 'Z1', name: 'Zone 1', capacity: 50 }],
		area_m2: 1200,
		facilities: {
			toilets_female: 10,
			toilets_male: 10,
			toilets_accessible: 2,
			showers: 8,
			water_points: 3,
			handwashing_stations: 6
		},
		location: { address: 'test addr', lat: 7, lng: 100 },
		contact: { name: 'Admin', phone: '0812345678' },
		created_at: '2024-01-01T00:00:00Z',
		updated_at: '2024-01-01T00:00:00Z'
	};

	it('migrates status open → operation_status active', () => {
		const migrated = migrateShelterV2ToCurrent(v2Master);
		expect(migrated.operation_status).toBe('active');
		expect(migrated.schema_v).toBe(3);
	});

	it('migrates status closed → operation_status closed', () => {
		const migrated = migrateShelterV2ToCurrent({ ...v2Master, status: 'closed' });
		expect(migrated.operation_status).toBe('closed');
	});

	it('preserves facilities (but adds car_toilet_accessible=null)', () => {
		const migrated = migrateShelterV2ToCurrent(v2Master);
		expect(migrated.facilities?.toilets_male).toBe(10);
		expect(migrated.facilities?.car_toilet_accessible).toBeNull();
	});

	it('adds new fields with safe defaults', () => {
		const migrated = migrateShelterV2ToCurrent(v2Master);
		expect(migrated.shelter_type).toBeNull();
		expect(migrated.area_type).toBeNull();
		expect(migrated.facilities?.car_toilet_accessible).toBeNull();
		expect(migrated.common_areas?.sub_storage).toEqual([]);
		expect(migrated.utilities?.communications).toEqual([]);
		expect(migrated.risk?.elevation_m).toBeNull();
	});

	it('expands zones with type/status/closed metadata', () => {
		const migrated = migrateShelterV2ToCurrent(v2Master);
		const z = migrated.zones?.[0];
		expect(z?.type).toBe('general');
		expect(z?.status).toBe('active');
		expect(z?.closed_at).toBeNull();
		expect(z?.closed_by).toBeNull();
		expect(z?.reason).toBeNull();
	});

	it('is idempotent — calling twice on v2 produces same result', () => {
		const first = migrateShelterV2ToCurrent(v2Master);
		const second = migrateShelterV2ToCurrent(first);
		expect(second.schema_v).toBe(3);
		expect(second.operation_status).toBe(first.operation_status);
	});

	it('is idempotent — calling on v3 returns as-is', () => {
		const v3 = migrateShelterV2ToCurrent(v2Master);
		const again = migrateShelterV2ToCurrent(v3);
		expect(again).toBe(v3);
	});
});
