import { describe, expect, it } from 'vitest';
import {
	COVERAGE_CSV_HEADER,
	coverageCsvFilename,
	coverageRowsToCsv,
	coverageStatusLabel,
	distributedByLabel
} from './meal-coverage-csv';
import type { CoverageViewRow } from './meal-coverage-view';

const row = (over: Partial<CoverageViewRow> = {}): CoverageViewRow => ({
	id: 'evacuee:A',
	name: 'สมชาย ใจดี',
	zone: 'Z1',
	received: ['breakfast'],
	missing: ['lunch', 'dinner'],
	counted: 1,
	complete: false,
	distributedBy: ['staff1'],
	judgedDays: 1,
	shortDays: 1,
	partialDays: 0,
	mealsReceived: 1,
	householdRecorded: [],
	...over
});
const zoneName = (code: string | null) => (code === 'Z1' ? 'อาคารหนึ่ง' : (code ?? ''));
const lines = (csv: string) => csv.split('\r\n');

describe('coverageStatusLabel', () => {
	it('says none or how many meals have a record', () => {
		expect(coverageStatusLabel(row({ received: [], counted: 0 }))).toBe(
			'รับไม่ถึง 2 มื้อ · ยังไม่มีบันทึกรับ'
		);
		expect(coverageStatusLabel(row())).toBe('รับไม่ถึง 2 มื้อ · รับแล้ว 1/2 มื้อ');
	});

	it('marks a complete row', () => {
		expect(
			coverageStatusLabel(row({ received: ['breakfast', 'lunch'], counted: 2, complete: true }))
		).toBe('รับ 2 มื้อขึ้นไป · 2/2 มื้อ');
	});
});

describe('coverageStatusLabel progress', () => {
	it('caps the shown count at 2', () => {
		expect(coverageStatusLabel(row({ counted: 3, complete: true }))).toBe(
			'รับ 2 มื้อขึ้นไป · 2/2 มื้อ'
		);
	});
});

describe('distributedByLabel', () => {
	it('joins the usernames and shows a dash when there are none', () => {
		expect(distributedByLabel(row({ distributedBy: ['amy', 'zed'] }))).toBe('amy, zed');
		expect(distributedByLabel(row({ distributedBy: [] }))).toBe('–');
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
		expect(out[1]).toBe(
			'"สมชาย ใจดี","อาคารหนึ่ง","เช้า","กลางวัน, เย็น","staff1","รับไม่ถึง 2 มื้อ · รับแล้ว 1/2 มื้อ","","1","1","0"'
		);
		expect(out[2]).toContain('"สมหญิง","","","กลางวัน, เย็น"');
	});

	it('writes who handed the meals out, empty when nobody is named', () => {
		const out = lines(
			coverageRowsToCsv(
				[row({ distributedBy: ['amy', 'zed'] }), row({ distributedBy: [] })],
				zoneName
			)
		);
		expect(COVERAGE_CSV_HEADER).toContain('ผู้แจก');
		expect(out[1]).toContain('"กลางวัน, เย็น","amy, zed","รับไม่ถึง 2 มื้อ · รับแล้ว 1/2 มื้อ"');
		expect(out[2]).toContain('"กลางวัน, เย็น","","รับไม่ถึง 2 มื้อ · รับแล้ว 1/2 มื้อ"');
	});

	it('quotes a distributor name that starts like a formula', () => {
		expect(coverageRowsToCsv([row({ distributedBy: ['=cmd'] })], zoneName)).toContain(`"'=cmd"`);
	});

	it('keeps the header alone for no rows', () => {
		expect(lines(coverageRowsToCsv([], zoneName))).toHaveLength(1);
	});

	it('includes the meals a household member has a record for', () => {
		const out = lines(coverageRowsToCsv([row({ householdRecorded: ['lunch'] })], zoneName));
		expect(out[1]).toContain('"รับไม่ถึง 2 มื้อ · รับแล้ว 1/2 มื้อ","กลางวัน"');
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

	it('names both ends of a range', () => {
		expect(coverageCsvFilename('SH001', '2026-11-03', '2026-11-09')).toBe(
			'meal-coverage-SH001-2026-11-03_2026-11-09.csv'
		);
		expect(coverageCsvFilename('SH001', '2026-11-09', '2026-11-09')).toBe(
			'meal-coverage-SH001-2026-11-09.csv'
		);
	});
});

describe('coverage over a range of days', () => {
	const ranged = row({ judgedDays: 7, shortDays: 3, partialDays: 1, mealsReceived: 9, counted: 8 });

	it('labels a row with the days it fell short instead of a one-day N/T', () => {
		expect(coverageStatusLabel(ranged, true)).toBe('รับไม่ถึง 2 มื้อบางวัน 3/7 วัน');
		expect(coverageStatusLabel(row({ ...ranged, shortDays: 0, complete: true }), true)).toBe(
			'รับ 2 มื้อขึ้นไปทุกวัน (7 วัน)'
		);
	});

	it('labels someone there only part of the day, whatever the range', () => {
		const partDay = row({ judgedDays: 0, shortDays: 0, partialDays: 1, counted: 0 });
		expect(coverageStatusLabel(partDay)).toBe('อยู่ในศูนย์ไม่เต็มวัน');
		expect(coverageStatusLabel(partDay, true)).toBe('อยู่ในศูนย์ไม่เต็มวัน');
	});

	it('adds the meals received, the days under 2 meals and the part days to the CSV', () => {
		const out = lines(coverageRowsToCsv([ranged], zoneName, true));
		expect(COVERAGE_CSV_HEADER.slice(-3)).toEqual([
			'จำนวนมื้อที่ได้รับ',
			'จำนวนวันที่ไม่ถึง 2 มื้อ',
			'จำนวนวันที่อยู่ในศูนย์ไม่เต็มวัน'
		]);
		expect(out[1].endsWith('"รับไม่ถึง 2 มื้อบางวัน 3/7 วัน","","9","3","1"')).toBe(true);
	});

	it('leaves the days-under-2-meals cell empty for someone never judged', () => {
		const partDay = row({ judgedDays: 0, shortDays: 0, partialDays: 2, mealsReceived: 1 });
		expect(
			lines(coverageRowsToCsv([partDay], zoneName))[1].endsWith(
				'"อยู่ในศูนย์ไม่เต็มวัน","","1","","2"'
			)
		).toBe(true);
	});
});

describe('distributedByLabel', () => {
	it('drops the CouchDB user-id prefix and repeats, and dashes when nobody is named', () => {
		expect(
			distributedByLabel({ distributedBy: ['org.couchdb.user:staff01', 'staff01', 'staff03'] })
		).toBe('staff01, staff03');
		expect(distributedByLabel({ distributedBy: [] })).toBe('–');
	});

	it('masks a phone number used as username to its last 4 digits, in the CSV too', () => {
		const phone = row({ distributedBy: ['0891234567', 'staff01'] });
		expect(distributedByLabel(phone)).toBe('•••4567, staff01');
		expect(coverageRowsToCsv([phone], zoneName)).toContain('"•••4567, staff01"');
		expect(coverageRowsToCsv([phone], zoneName)).not.toContain('0891234567');
	});
});
