import { describe, it, expect } from 'vitest';
import { H } from '../domain/columns';
import {
	buildMasterLookup,
	emptyLookups,
	validateRow,
	type Lookups,
	type RawRow,
	type RawSheetRow
} from '../domain/import-row';
import { buildSampleWorkbook } from './sample-row';
import type { TemplateMasters } from './template';

function emptyMasters(): TemplateMasters {
	return { shelter_type: [] };
}

function mastersWithShelterType(): TemplateMasters {
	return { shelter_type: [{ value: 'school', label: 'โรงเรียน' }] };
}

/** Lookups matching {@link mastersWithShelterType} — the sample's label must resolve. */
function lookupsWithShelterType(): Lookups {
	return { shelter_type: buildMasterLookup([{ code: 'school', label: 'โรงเรียน' }]) };
}

/** Cast the sample's header -> value map to the string-keyed `RawRow` the validator expects. */
function toRawRow(record: Record<string, string | number>): RawRow {
	return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, String(v)]));
}

function toZoneRows(zones: Record<string, string | number>[]): RawSheetRow[] {
	return zones.map((cells, i) => ({ ref: '1', line: i + 1, cells: toRawRow(cells) }));
}

describe('buildSampleWorkbook', () => {
	it('leaves ประเภทศูนย์พักพิง empty when no shelter_type master data exists', () => {
		const sample = buildSampleWorkbook(emptyMasters());
		expect(sample.shelter[H.shelter_type]).toBeUndefined();
	});

	it('fills ประเภทศูนย์พักพิง with the first shelter_type label when master data exists', () => {
		const sample = buildSampleWorkbook(mastersWithShelterType());
		expect(sample.shelter[H.shelter_type]).toBe('โรงเรียน');
	});

	it('passes validateRow cleanly with zero errors', () => {
		const sample = buildSampleWorkbook(mastersWithShelterType());
		const raw = toRawRow(sample.shelter);
		const zoneRows = toZoneRows(sample.zones);

		const result = validateRow(raw, 1, lookupsWithShelterType(), zoneRows);

		expect(result.errors).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.shelter).toBeDefined();
	});

	it('produces the expected zones', () => {
		const sample = buildSampleWorkbook(emptyMasters());
		const raw = toRawRow(sample.shelter);
		const zoneRows = toZoneRows(sample.zones);
		const result = validateRow(raw, 1, emptyLookups(), zoneRows);

		expect(result.shelter?.zones).toHaveLength(2);
		expect(result.shelter?.zones.map((z) => z.code)).toEqual(['A', 'B']);
		expect(result.shelter?.zones.reduce((sum, z) => sum + z.capacity, 0)).toBe(150);
	});

	it('produces the expected pet conditions across categories', () => {
		const sample = buildSampleWorkbook(emptyMasters());
		const raw = toRawRow(sample.shelter);
		const result = validateRow(raw, 1, emptyLookups());

		const categories = result.shelter?.admission_policy.pet_policy.categories ?? [];
		expect(result.shelter?.admission_policy.pet_policy.policy).toBe('conditional');

		const small = categories.find((c) => c.category === 'small_general');
		expect(small?.conditions).toContain('bring_own_cage');

		const large = categories.find((c) => c.category === 'large_dog');
		expect(large?.conditions).toContain('muzzle_and_leash');

		const livestock = categories.find((c) => c.category === 'livestock');
		expect(livestock?.max_capacity).toBe(5);
	});

	it('produces the expected supported parking vehicles', () => {
		const sample = buildSampleWorkbook(emptyMasters());
		const raw = toRawRow(sample.shelter);
		const result = validateRow(raw, 1, emptyLookups());

		expect(result.shelter?.parking_policy.availability).toBe('available');
		const vehicles = result.shelter?.parking_policy.supported_vehicles ?? [];
		expect(vehicles.map((v) => v.type).sort()).toEqual(['car', 'motorcycle', 'truck']);
		expect(vehicles.find((v) => v.type === 'motorcycle')?.max_capacity).toBe(20);
	});
});
