import { describe, expect, it } from 'vitest';
import { H } from '../domain/columns';
import { emptyLookups, validateRow, type RawRow, type RawSheetRow } from '../domain/import-row';
import { buildSampleCsvRows, buildSampleWorkbook } from './sample-row';

/** Cast the sample's header → value map to the string-keyed `RawRow` the validator expects. */
function toRawRow(record: Record<string, string | number>): RawRow {
	return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, String(v)]));
}

function toMemberRows(members: Record<string, string | number>[]): RawSheetRow[] {
	return members.map((cells, i) => ({ ref: '1', line: i + 1, cells: toRawRow(cells) }));
}

describe('buildSampleWorkbook', () => {
	it('fills zone and community with free-text sample labels (CR-137)', () => {
		const sample = buildSampleWorkbook();

		expect(sample.household[H.municipality_zone]).toBe('เขตเทศบาลนครหาดใหญ่ 1');
		expect(sample.household[H.community]).toBe('ชุมชนริมน้ำ');
	});

	it('passes the real validator with empty lookups', () => {
		const sample = buildSampleWorkbook();
		const result = validateRow(
			toRawRow(sample.household),
			1,
			emptyLookups(),
			toMemberRows(sample.members)
		);

		expect(result.errors).toEqual([]);
		expect(result.ok).toBe(true);
		expect(result.payload?.household.municipality_zone).toBe('เขตเทศบาลนครหาดใหญ่ 1');
		expect(result.payload?.household.community).toBe('ชุมชนริมน้ำ');
	});

	it('demonstrates the optional columns people ask about', () => {
		const result = validateRow(toRawRow(buildSampleWorkbook().household), 1, emptyLookups());

		expect(result.payload?.household.pets).toEqual([
			{ species: 'dog', count: 1, notes: 'มีกรงและสมุดวัคซีน' }
		]);
		expect(result.payload?.household.vehicles).toHaveLength(1);
		expect(result.payload?.head.emergency_contact?.relation).toBe('คู่สมรส');
	});

	it('shows a member with no phone and a vulnerability tag', () => {
		const sample = buildSampleWorkbook();
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
		const rows = buildSampleCsvRows();

		expect(rows).toHaveLength(4);
		expect(rows[0][H.role]).toBe('หัวหน้าครัวเรือน');
		expect(rows.slice(1).every((r) => r[H.role] === 'สมาชิก')).toBe(true);
		expect(rows.every((r) => r[H.ref] === 1)).toBe(true);
	});
});
