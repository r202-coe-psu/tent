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
		expect(z.reopened_at).toBeNull();
		expect(z.reopened_by).toBeNull();
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

	it('rejects invalid closed_at (not a datetime)', () => {
		expect(() =>
			zoneSchema.parse({ code: 'Z1', name: 'X', capacity: 1, closed_at: 'not-a-date' })
		).toThrow();
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
		expect(migrated.schema_v).toBe(4);
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
		expect(z?.reopened_at).toBeNull();
		expect(z?.reopened_by).toBeNull();
		expect(z?.reason).toBeNull();
	});

	it('backfills capacity from v2 top-level when present', () => {
		const migrated = migrateShelterV2ToCurrent({ ...v2Master, capacity: 250 });
		expect(migrated.capacity).toBe(250);
	});

	it('backfills capacity from sum of zones when v2 top-level missing or zero', () => {
		const without = migrateShelterV2ToCurrent({ ...v2Master, capacity: undefined });
		// 50 (single zone)
		expect(without.capacity).toBe(50);
		const zero = migrateShelterV2ToCurrent({ ...v2Master, capacity: 0 });
		expect(zero.capacity).toBe(50);
		const multi = migrateShelterV2ToCurrent({
			...v2Master,
			capacity: undefined,
			zones: [
				{ code: 'Z1', name: 'A', capacity: 30 },
				{ code: 'Z2', name: 'B', capacity: 70 }
			]
		});
		expect(multi.capacity).toBe(100);
	});

	it('falls back to 100 capacity when no zones and no v2 capacity', () => {
		const noZones = migrateShelterV2ToCurrent({ ...v2Master, zones: [], capacity: undefined });
		expect(noZones.capacity).toBe(100);
	});

	it('drops v2-only fields (status, items, rules, sops)', () => {
		const migrated = migrateShelterV2ToCurrent({
			...v2Master,
			items: [] as never,
			rules: [] as never,
			sops: [] as never
		});
		expect((migrated as unknown as Record<string, unknown>).status).toBeUndefined();
		expect((migrated as unknown as Record<string, unknown>).items).toBeUndefined();
		expect((migrated as unknown as Record<string, unknown>).rules).toBeUndefined();
		expect((migrated as unknown as Record<string, unknown>).sops).toBeUndefined();
	});

	it('is idempotent — calling twice on v2 produces same result', () => {
		const first = migrateShelterV2ToCurrent(v2Master);
		const second = migrateShelterV2ToCurrent(first);
		expect(second.schema_v).toBe(4);
		expect(second.operation_status).toBe(first.operation_status);
	});

	it('is idempotent — calling on current (v4) returns as-is', () => {
		const current = migrateShelterV2ToCurrent(v2Master);
		const again = migrateShelterV2ToCurrent(current);
		expect(again).toBe(current);
	});
});

// ===== CR-023 v4 / Addendum A (v4.1) =====

describe('CR-023 v4 — section 1/2 enums & fields', () => {
	it('accepts area_type + project_level enums', () => {
		const r = shelterSchema.parse({
			...validShelterInput,
			area_type: 'indoor',
			project_level: 'lao'
		});
		expect(r.area_type).toBe('indoor');
		expect(r.project_level).toBe('lao');
	});

	it('rejects area_type / project_level outside enum', () => {
		expect(() => shelterSchema.parse({ ...validShelterInput, area_type: 'castle' })).toThrow();
		expect(() => shelterSchema.parse({ ...validShelterInput, project_level: 'galaxy' })).toThrow();
	});

	it('accepts structured address + key personnel', () => {
		const r = shelterSchema.parse({
			...validShelterInput,
			municipality_zone: 'MZ1',
			community: 'C1',
			address_no: '99/1',
			postal_code: '90110',
			key_personnel: { eoc_liaison: { name: 'A', phone: '08' } }
		});
		expect(r.municipality_zone).toBe('MZ1');
		expect(r.key_personnel?.eoc_liaison?.name).toBe('A');
	});
});

describe('CR-023 — empty submit fills policy defaults', () => {
	it('defaults admission/luggage/parking policies when omitted', () => {
		const r = shelterSchema.parse(validShelterInput);
		expect(r.admission_policy).toEqual({
			supported_vulnerable_groups: [],
			pet_policy: { policy: null, categories: [] }
		});
		expect(r.luggage_policy).toEqual({
			limitation: null,
			max_per_family: null,
			rules: [],
			rules_other: null
		});
		expect(r.parking_policy).toEqual({
			availability: null,
			supported_vehicles: [],
			rules: [],
			rules_other: null
		});
	});
});

describe('CR-023 Addendum A — section 6 nested pet policy', () => {
	it('accepts conditional policy with categories + conditions + other', () => {
		const r = shelterSchema.parse({
			...validShelterInput,
			admission_policy: {
				supported_vulnerable_groups: ['V1', 'V2'],
				pet_policy: {
					policy: 'conditional',
					categories: [
						{
							category: 'small_general',
							conditions: ['vaccine_book', 'caged_or_leashed'],
							other: 'x'
						},
						{ category: 'livestock', conditions: [], other: null }
					]
				}
			}
		});
		expect(r.admission_policy.pet_policy.policy).toBe('conditional');
		expect(r.admission_policy.pet_policy.categories).toHaveLength(2);
		expect(r.admission_policy.supported_vulnerable_groups).toEqual(['V1', 'V2']);
	});

	it('rejects pet category / condition outside whitelist', () => {
		expect(() =>
			shelterSchema.parse({
				...validShelterInput,
				admission_policy: {
					pet_policy: { policy: 'conditional', categories: [{ category: 'dragon' }] }
				}
			})
		).toThrow();
		expect(() =>
			shelterSchema.parse({
				...validShelterInput,
				admission_policy: {
					pet_policy: {
						policy: 'conditional',
						categories: [{ category: 'small_general', conditions: ['must_be_cute'] }]
					}
				}
			})
		).toThrow();
	});

	it('rejects a condition from another category (per-category whitelist, D-A2 revised)', () => {
		expect(() =>
			shelterSchema.parse({
				...validShelterInput,
				admission_policy: {
					pet_policy: {
						policy: 'conditional',
						// muzzle_and_leash is a large_dog condition, not valid for small_general.
						categories: [{ category: 'small_general', conditions: ['muzzle_and_leash'] }]
					}
				}
			})
		).toThrow();
	});

	it('accepts large_dog with its own condition whitelist', () => {
		const r = shelterSchema.parse({
			...validShelterInput,
			admission_policy: {
				pet_policy: {
					policy: 'conditional',
					categories: [
						{
							category: 'large_dog',
							conditions: ['muzzle_and_leash', 'aggressive_behavior_expel_right'],
							other: null
						}
					]
				}
			}
		});
		expect(r.admission_policy.pet_policy.categories[0]).toEqual({
			category: 'large_dog',
			conditions: ['muzzle_and_leash', 'aggressive_behavior_expel_right'],
			other: null
		});
	});

	it('accepts livestock with max_capacity + location + its own condition whitelist', () => {
		const r = shelterSchema.parse({
			...validShelterInput,
			admission_policy: {
				pet_policy: {
					policy: 'conditional',
					categories: [
						{
							category: 'livestock',
							max_capacity: 5,
							location: 'สนามหญ้าหลังอาคารเรียน',
							conditions: ['owner_provides_feed'],
							other: null
						}
					]
				}
			}
		});
		const entry = r.admission_policy.pet_policy.categories[0];
		expect(entry).toMatchObject({
			category: 'livestock',
			max_capacity: 5,
			location: 'สนามหญ้าหลังอาคารเรียน',
			conditions: ['owner_provides_feed']
		});
	});
});

describe('CR-023 Addendum A — section 7 luggage policy', () => {
	it('accepts limited + max_per_family + rules', () => {
		const r = shelterSchema.parse({
			...validShelterInput,
			luggage_policy: {
				limitation: 'limited',
				max_per_family: 5,
				rules: ['no_hazardous_items', 'has_temp_storage_service'],
				rules_other: 'note'
			}
		});
		expect(r.luggage_policy.max_per_family).toBe(5);
		expect(r.luggage_policy.rules).toContain('no_hazardous_items');
	});

	it('rejects luggage rule outside whitelist', () => {
		expect(() =>
			shelterSchema.parse({
				...validShelterInput,
				luggage_policy: { rules: ['free_pizza'] }
			})
		).toThrow();
	});
});

describe('CR-023 Addendum A — section 8 parking policy', () => {
	it('accepts available + supported vehicles + rules', () => {
		const r = shelterSchema.parse({
			...validShelterInput,
			parking_policy: {
				availability: 'available',
				supported_vehicles: [
					{ type: 'car', max_capacity: 20 },
					{ type: 'boat', max_capacity: null }
				],
				rules: ['no_liability', 'ev_emergency_charging'],
				rules_other: null
			}
		});
		expect(r.parking_policy.supported_vehicles).toHaveLength(2);
		expect(r.parking_policy.rules).toContain('ev_emergency_charging');
	});

	it('rejects vehicle type / parking rule outside whitelist', () => {
		expect(() =>
			shelterSchema.parse({
				...validShelterInput,
				parking_policy: { supported_vehicles: [{ type: 'spaceship' }] }
			})
		).toThrow();
		expect(() =>
			shelterSchema.parse({
				...validShelterInput,
				parking_policy: { rules: ['free_valet'] }
			})
		).toThrow();
	});
});

describe('CR-023 — zone / facilities / common-area additions', () => {
	it('accepts zone area_m2 + specifics', () => {
		const r = zoneSchema.parse({
			code: 'Z1',
			name: 'A',
			capacity: 10,
			area_m2: 50,
			specifics: 'x'
		});
		expect(r.area_m2).toBe(50);
		expect(r.specifics).toBe('x');
	});

	it('accepts facilities.car_toilet_supported + common-area additions', () => {
		const f = facilitiesSchema.parse({ car_toilet_accessible: true, car_toilet_supported: 2 });
		expect(f.car_toilet_supported).toBe(2);
		const c = commonAreasSchema.parse({
			isolation_room: true,
			women_child_friendly_space: false,
			logistics_area_m2: 150,
			sub_storage: [{ name: 'S', type: 'general', area_m2: 20 }]
		});
		expect(c.logistics_area_m2).toBe(150);
		expect(c.sub_storage[0].area_m2).toBe(20);
	});

	it('accepts risk.secondary_muster_point', () => {
		const r = riskSchema.parse({ secondary_muster_point: 'field B' });
		expect(r.secondary_muster_point).toBe('field B');
	});
});

describe('CR-023 — migrate v3 → v4 default-fill', () => {
	it('fills new v4 fields on a v3 doc without them', () => {
		const v3doc = {
			_id: 'shelter:x',
			type: 'shelter' as const,
			schema_v: 3,
			code: 'SH001',
			name: 'X',
			operation_status: 'standby' as const,
			capacity: 10,
			facilities: { toilets_male: 1 },
			common_areas: { sub_storage: [{ name: 'S', type: 'general' }] },
			utilities: { communications: [] },
			risk: { elevation_m: 5 },
			zones: [{ code: 'Z1', name: 'A', capacity: 10 }],
			created_at: '2024-01-01T00:00:00Z',
			updated_at: '2024-01-01T00:00:00Z'
		} as unknown as ShelterMasterV2;
		const m = migrateShelterV2ToCurrent(v3doc);
		expect(m.schema_v).toBe(4);
		expect(m.project_level).toBeNull();
		expect(m.municipality_zone).toBeNull();
		expect(m.admission_policy).toEqual({
			supported_vulnerable_groups: [],
			pet_policy: { policy: null, categories: [] }
		});
		expect(m.luggage_policy?.limitation).toBeNull();
		expect(m.parking_policy?.availability).toBeNull();
		expect(m.facilities?.car_toilet_supported).toBeNull();
		expect(m.risk?.secondary_muster_point).toBeNull();
		expect(m.zones?.[0].area_m2).toBeNull();
	});
});
