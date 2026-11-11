import { describe, expect, it } from 'vitest';
import {
	COVERAGE_CSV_HEADER,
	coverageCsvFilename,
	coverageRowsToCsv,
	coverageStatusLabel
} from './meal-coverage-csv';
import type { CoverageViewRow } from './meal-coverage-view';

const row = (over: Partial<CoverageViewRow> = {}): CoverageViewRow => ({
	id: 'evacuee:A',
	name: 'สมชาย ใจดี',
	zone: 'Z1',
	received: ['breakfast'],
	missing: ['lunch', 'dinner'],
	householdRecorded: [],
	...over
});
const zoneName = (code: string | null) => (code === 'Z1' ? 'อาคารหนึ่ง' : (code ?? ''));
const lines = (csv: string) => csv.split('\r\n');

describe('coverageStatusLabel', () => {
	it('says none or how many meals have a record', () => {
		expect(coverageStatusLabel(row({ received: [] }))).toBe('ยังไม่มีบันทึก');
		expect(coverageStatusLabel(row())).toBe('มีบันทึก 1 มื้อ');
	});
});

describe('coverageRowsToCsv', () => {
	it('starts with the header and writes one line per row with Thai meal names', () => {
		const out = lines(
			coverageRowsToCsv(
				[row(), row({ id: 'evacuee:B', name: 'สมหญิง', received: [], zone: null })],
				zoneName
			)
		);
		expect(out).toHaveLength(3);
		expect(out[0]).toBe(COVERAGE_CSV_HEADER.map((h) => `"${h}"`).join(','));
		expect(out[1]).toBe('"สมชาย ใจดี","อาคารหนึ่ง","เช้า","กลางวัน, เย็น","มีบันทึก 1 มื้อ",""');
		expect(out[2]).toContain('"สมหญิง","","","กลางวัน, เย็น"');
	});

	it('keeps the header alone for no rows', () => {
		expect(lines(coverageRowsToCsv([], zoneName))).toHaveLength(1);
	});

	it('includes the meals a household member has a record for', () => {
		const out = lines(coverageRowsToCsv([row({ householdRecorded: ['lunch'] })], zoneName));
		expect(out[1].endsWith('"กลางวัน"')).toBe(true);
	});

	it('escapes quotes, commas and newlines inside a cell', () => {
		const out = coverageRowsToCsv([row({ name: 'a "b", c\nd' })], zoneName);
		expect(out).toContain('"a ""b"", c\nd"');
		expect(out.split('\r\n')).toHaveLength(2);
	});

	it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\t=1', '\r=1'])(
		'prefixes a leading formula character in %j',
		(name) => {
			const out = coverageRowsToCsv([row({ name })], zoneName);
			expect(out).toContain(`"'${name}"`);
		}
	);

	it('leaves an ordinary name untouched', () => {
		expect(coverageRowsToCsv([row({ name: 'สมชาย' })], zoneName)).toContain('"สมชาย"');
	});
});

describe('coverageCsvFilename', () => {
	it('names the shelter and the day', () => {
		expect(coverageCsvFilename('SH001', '2026-11-09')).toBe('meal-coverage-SH001-2026-11-09.csv');
	});
});
