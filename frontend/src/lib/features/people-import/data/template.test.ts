import { describe, expect, it } from 'vitest';
import { H, normalizeHeader } from '../domain/columns';
import { emptyLookups, validateWorkbook } from '../domain/import-row';
import { parsePeopleWorkbook } from './parse';
import {
	buildPeopleCsvTemplateBlob,
	buildPeopleTemplateBlob,
	type TemplateMasters
} from './template';

const MASTERS: TemplateMasters = {
	municipality_zone: [{ value: 'Z1', label: 'เขต 1' }],
	community: [{ value: 'C1', label: 'ชุมชนริมน้ำ' }]
};

const NO_MASTERS: TemplateMasters = { municipality_zone: [], community: [] };

async function generateAndParse(masters: TemplateMasters = NO_MASTERS) {
	const blob = await buildPeopleTemplateBlob(masters, { withSample: true });
	const file = new File([await blob.arrayBuffer()], 'template.xlsx');
	return parsePeopleWorkbook(file);
}

describe('normalizeHeader', () => {
	it('strips the required marker from a header cell', () => {
		expect(normalizeHeader('ชื่อ *')).toBe('ชื่อ');
		expect(normalizeHeader(' ปีเกิด (พ.ศ.)  * ')).toBe('ปีเกิด (พ.ศ.)');
	});

	it('leaves an unmarked header untouched', () => {
		expect(normalizeHeader('จังหวัด')).toBe('จังหวัด');
	});
});

describe('xlsx template → parse round trip', () => {
	it('reads back required columns whose header carries the "*" marker', async () => {
		const { households, members } = await generateAndParse();

		expect(households).toHaveLength(1);
		expect(households[0].cells[H.first_name]).toBeTruthy();
		expect(households[0].cells[H.gender]).toBeTruthy();
		// A column from the second 1:1 sheet — proves the merge still joins on ลำดับที่.
		expect(households[0].cells[H.address_no]).toBeTruthy();

		expect(members.length).toBeGreaterThan(0);
		expect(members[0].cells[H.first_name]).toBeTruthy();
	});

	it('joins member rows through the "ลำดับที่ครัวเรือน" column', async () => {
		const { households, members } = await generateAndParse();

		expect(members[0].cells[H.member_household_ref]).toBe('1');
		expect(members.every((m) => m.ref === households[0].ref)).toBe(true);
	});

	it('produces a sample workbook that imports without a single error', async () => {
		const rows = validateWorkbook(await generateAndParse(), emptyLookups());

		expect(rows).toHaveLength(1);
		expect(rows[0].errors).toEqual([]);
		expect(rows[0].ok).toBe(true);
		expect(rows[0].memberCount).toBe(3);
	});

	it('keeps a leading-zero phone number as text instead of a number', async () => {
		const { households } = await generateAndParse();
		expect(households[0].cells[H.phone]).toBe('0812345678');
	});

	it('falls back to the first worksheet when the sheets were renamed', async () => {
		const ExcelJS = (await import('exceljs')).default;
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(
			await (await buildPeopleTemplateBlob(NO_MASTERS, { withSample: true })).arrayBuffer()
		);
		wb.worksheets.forEach((ws, i) => (ws.name = `Sheet${i + 1}`));

		const renamed = new File([await wb.xlsx.writeBuffer()], 'renamed.xlsx');
		const { households } = await parsePeopleWorkbook(renamed);

		expect(households).toHaveLength(1);
		expect(households[0].cells[H.first_name]).toBeTruthy();
	});

	it('only pre-fills master-data cells the shelter actually has', async () => {
		const withMasters = await generateAndParse(MASTERS);
		expect(withMasters.households[0].cells[H.municipality_zone]).toBe('เขต 1');

		const without = await generateAndParse(NO_MASTERS);
		expect(without.households[0].cells[H.municipality_zone]).toBe('');
	});
});

describe('csv template → parse round trip', () => {
	async function parseCsvTemplate(masters: TemplateMasters = NO_MASTERS) {
		const blob = buildPeopleCsvTemplateBlob(masters, { withSample: true });
		return parsePeopleWorkbook(new File([await blob.text()], 'template.csv'));
	}

	it('groups the flat rows back into one household with its members', async () => {
		const { households, members } = await parseCsvTemplate();

		expect(households).toHaveLength(1);
		expect(households[0].cells[H.first_name]).toBe('สมชาย');
		expect(members).toHaveLength(3);
	});

	it('produces the same importable household as the workbook', async () => {
		const rows = validateWorkbook(await parseCsvTemplate(), emptyLookups());

		expect(rows[0].errors).toEqual([]);
		expect(rows[0].ok).toBe(true);
		expect(rows[0].memberCount).toBe(3);
		expect(rows[0].payload?.household.address_no).toBe('99/1');
	});

	it('reads the household columns from the head row only', async () => {
		const { members } = await parseCsvTemplate();
		// The members' own address cells are blank in the flat file.
		expect(members[0].cells[H.address_no]).toBe('');
	});
});

describe('csv template shape', () => {
	it('marks required columns in the header text so the parser strips them back', async () => {
		const text = await buildPeopleCsvTemplateBlob(NO_MASTERS).text();
		const header = text.replace(/^\uFEFF/, '').split('\r\n')[0];

		expect(header).toContain(`${H.first_name} *`);
		expect(header.split(',')[0]).toContain(H.ref);
		expect(header).toContain(H.role);
		// The household's own columns ride along on the flat row too.
		expect(header).toContain(H.municipality_zone);
	});
});
