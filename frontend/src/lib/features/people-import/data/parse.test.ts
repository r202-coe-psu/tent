import { describe, expect, it } from 'vitest';
import { H } from '../domain/columns';
import { isCsvFile, parseCsvText, parsePeopleWorkbook } from './parse';

function csvFile(text: string, name = 'people.csv'): File {
	return new File([text], name, { type: 'text/csv' });
}

const HEADER = [H.ref, H.role, H.first_name, H.last_name, H.gender, H.address_no].join(',');

describe('parseCsvText', () => {
	it('reads quoted fields, escaped quotes and both line endings', () => {
		const rows = parseCsvText('a,"b,c",d\r\n1,"เขา ""ดี""",3\n');

		expect(rows).toEqual([
			['a', 'b,c', 'd'],
			['1', 'เขา "ดี"', '3']
		]);
	});

	it('strips the BOM Excel writes, so the first header still matches', () => {
		expect(parseCsvText('\uFEFFชื่อ,นามสกุล\n')[0][0]).toBe('ชื่อ');
	});
});

describe('isCsvFile', () => {
	it('recognises a csv by extension or mime type', () => {
		expect(isCsvFile(csvFile('a', 'people.CSV'))).toBe(true);
		expect(isCsvFile(new File(['a'], 'people.xlsx'))).toBe(false);
	});
});

describe('flat csv → household + members', () => {
	it('groups people by ลำดับที่ and takes the household columns from the head row', async () => {
		const wb = await parsePeopleWorkbook(
			csvFile(
				[
					HEADER,
					'1,หัวหน้าครัวเรือน,สมชาย,ใจดี,ชาย,99/1',
					'1,สมาชิก,สมหญิง,ใจดี,หญิง,',
					'2,หัวหน้าครัวเรือน,มานี,มีนา,หญิง,12'
				].join('\n')
			)
		);

		expect(wb.households.map((h) => h.cells[H.first_name])).toEqual(['สมชาย', 'มานี']);
		expect(wb.households[0].cells[H.address_no]).toBe('99/1');
		expect(wb.members).toHaveLength(1);
		expect(wb.members[0].ref).toBe('1');
	});

	it('promotes the first row of a group when no row is marked as head', async () => {
		const wb = await parsePeopleWorkbook(
			csvFile([HEADER, '1,,สมชาย,ใจดี,ชาย,99/1', '1,,สมหญิง,ใจดี,หญิง,'].join('\n'))
		);

		expect(wb.households).toHaveLength(1);
		expect(wb.households[0].cells[H.first_name]).toBe('สมชาย');
		expect(wb.members).toHaveLength(1);
	});

	it('takes the marked head even when it is not the first row of its group', async () => {
		const wb = await parsePeopleWorkbook(
			csvFile(
				[HEADER, '1,สมาชิก,สมหญิง,ใจดี,หญิง,', '1,หัวหน้าครัวเรือน,สมชาย,ใจดี,ชาย,99/1'].join('\n')
			)
		);

		expect(wb.households[0].cells[H.first_name]).toBe('สมชาย');
		expect(wb.members[0].cells[H.first_name]).toBe('สมหญิง');
	});

	it('imports a second head row in one group as a member rather than a rival household', async () => {
		const wb = await parsePeopleWorkbook(
			csvFile(
				[
					HEADER,
					'1,หัวหน้าครัวเรือน,สมชาย,ใจดี,ชาย,99/1',
					'1,หัวหน้าครัวเรือน,มานี,มีนา,หญิง,'
				].join('\n')
			)
		);

		expect(wb.households).toHaveLength(1);
		expect(wb.members.map((m) => m.cells[H.first_name])).toEqual(['มานี']);
	});

	it('treats a person with no ลำดับที่ as their own household', async () => {
		const wb = await parsePeopleWorkbook(
			csvFile([HEADER, ',,สมชาย,ใจดี,ชาย,99/1', ',,มานี,มีนา,หญิง,12'].join('\n'))
		);

		expect(wb.households).toHaveLength(2);
		expect(wb.members).toHaveLength(0);
	});

	it('ignores blank rows and a file with no recognised headers', async () => {
		const blank = await parsePeopleWorkbook(csvFile([HEADER, '1,,,,,', '2,,,,,'].join('\n')));
		expect(blank.households).toEqual([]);

		const unknown = await parsePeopleWorkbook(csvFile('foo,bar\n1,2\n'));
		expect(unknown.households).toEqual([]);
	});

	it('strips the required marker from csv headers', async () => {
		const wb = await parsePeopleWorkbook(
			csvFile(
				[`${H.ref},${H.first_name} *,${H.last_name} *,${H.gender} *`, '1,สมชาย,ใจดี,ชาย'].join('\n')
			)
		);

		expect(wb.households[0].cells[H.first_name]).toBe('สมชาย');
	});
});
