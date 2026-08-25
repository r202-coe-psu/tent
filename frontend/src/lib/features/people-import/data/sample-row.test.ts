import { describe, expect, it } from 'vitest';
import { H } from '../domain/columns';
import {
	buildMasterLookup,
	emptyLookups,
	validateRow,
	type Lookups,
	type RawRow,
	type RawSheetRow
} from '../domain/import-row';
import { buildSampleCsvRows, buildSampleWorkbook } from './sample-row';
import type { TemplateMasters } from './template';

const NO_MASTERS: TemplateMasters = { municipality_zone: [], community: [] };
const MASTERS: TemplateMasters = {
	municipality_zone: [{ value: 'Z1', label: 'เขต 1' }],
	community: [{ value: 'C1', label: 'ชุมชนริมน้ำ' }]
};

/** Lookups matching {@link MASTERS} — the sample's labels must resolve. */
function matchingLookups(): Lookups {
	return {
		municipality_zone: buildMasterLookup([{ code: 'Z1', label: 'เขต 1' }]),
		community: buildMasterLookup([{ code: 'C1', label: 'ชุมชนริมน้ำ' }])
	};
}

/** Cast the sample's header → value map to the string-keyed `RawRow` the validator expects. */
function toRawRow(record: Record<string, string | number>): RawRow {
	return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, String(v)]));
}

function toMemberRows(members: Record<string, string | number>[]): RawSheetRow[] {
	return members.map((cells, i) => ({ ref: '1', line: i + 1, cells: toRawRow(cells) }));
}

describe('buildSampleWorkbook', () => {
	it('leaves the master-data cells empty when the shelter has no lists yet', () => {
		const sample = buildSampleWorkbook(NO_MASTERS);

		expect(sample.household[H.municipality_zone]).toBeUndefined();
		expect(sample.household[H.community]).toBeUndefined();
	});

	it('fills the master-data cells with real labels when the shelter has them', () => {
		const sample = buildSampleWorkbook(MASTERS);

		expect(sample.household[H.municipality_zone]).toBe('เขต 1');
		expect(sample.household[H.community]).toBe('ชุมชนริมน้ำ');
	});

	it('passes the real validator with no master data', () => {
		const sample = buildSampleWorkbook(NO_MASTERS);
		const result = validateRow(
			toRawRow(sample.household),
			1,
			emptyLookups(),
			toMemberRows(sample.members)
		);

		expect(result.errors).toEqual([]);
		expect(result.ok).toBe(true);
	});

	it('passes the real validator with master data', () => {
		const sample = buildSampleWorkbook(MASTERS);
		const result = validateRow(
			toRawRow(sample.household),
			1,
			matchingLookups(),
			toMemberRows(sample.members)
		);

		expect(result.errors).toEqual([]);
		expect(result.payload?.household.municipality_zone).toBe('Z1');
	});

	it('demonstrates the optional columns people ask about', () => {
		const result = validateRow(
			toRawRow(buildSampleWorkbook(NO_MASTERS).household),
			1,
			emptyLookups()
		);

		expect(result.payload?.household.pets).toEqual([
			{ species: 'dog', count: 1, notes: 'มีกรงและสมุดวัคซีน' }
		]);
		expect(result.payload?.household.vehicles).toHaveLength(1);
		expect(result.payload?.head.emergency_contact?.relation).toBe('คู่สมรส');
	});

	it('shows a member with no phone and a vulnerability tag', () => {
		const sample = buildSampleWorkbook(NO_MASTERS);
		const result = validateRow(
			toRawRow(sample.household),
			1,
			emptyLookups(),
			toMemberRows(sample.members)
		);

		const infant = result.payload?.members.find((m) => m.evacuee.first_name === 'สมศรี');
		expect(infant?.evacuee.phone).toBeNull();
		expect(infant?.evacuee.special_needs).toEqual(['infant']);
	});
});

describe('buildSampleCsvRows', () => {
	it('flattens the household into one head row followed by its members', () => {
		const rows = buildSampleCsvRows(NO_MASTERS);

		expect(rows).toHaveLength(4);
		expect(rows[0][H.role]).toBe('หัวหน้าครัวเรือน');
		expect(rows.slice(1).every((r) => r[H.role] === 'สมาชิก')).toBe(true);
		expect(rows.every((r) => r[H.ref] === 1)).toBe(true);
	});
});
