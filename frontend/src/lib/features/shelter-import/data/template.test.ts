import { describe, expect, it } from 'vitest';
import { H, normalizeHeader, ZONE_SHEET_NAME } from '../domain/columns';
import { parseShelterWorkbook } from './parse';
import { buildShelterTemplateBlob } from './template';

const MASTERS = { shelter_type: [{ value: 'school', label: 'โรงเรียน' }] };

async function generateAndParse() {
	const blob = await buildShelterTemplateBlob(MASTERS, { withSample: true });
	const file = new File([await blob.arrayBuffer()], 'template.xlsx');
	return parseShelterWorkbook(file);
}

describe('normalizeHeader', () => {
	it('strips the required marker from a header cell', () => {
		expect(normalizeHeader('ชื่อศูนย์พักพิง *')).toBe('ชื่อศูนย์พักพิง');
		expect(normalizeHeader(' ความจุสูงสุด (คน)  * ')).toBe('ความจุสูงสุด (คน)');
	});

	it('leaves an unmarked header untouched', () => {
		expect(normalizeHeader('จังหวัด')).toBe('จังหวัด');
	});

	it('reduces a standalone marker cell to an empty (ignored) header', () => {
		expect(normalizeHeader('*')).toBe('');
	});
});

describe('template → parse round trip', () => {
	it('reads back required columns whose header carries the "*" marker', async () => {
		const { shelters, zones } = await generateAndParse();

		expect(shelters).toHaveLength(1);
		expect(shelters[0].cells[H.name]).toBeTruthy();
		expect(shelters[0].cells[H.capacity]).toBeTruthy();
		// A column on a non-main 1:1 sheet — proves the merge still joins on ลำดับที่.
		expect(shelters[0].cells[H.toilets_male]).toBeTruthy();

		expect(zones.length).toBeGreaterThan(0);
		expect(zones[0].cells[H.zone_code]).toBeTruthy();
		expect(zones[0].cells[H.zone_capacity]).toBeTruthy();
	});

	it('joins zone rows through the "รหัสศูนย์พักพิง" column', async () => {
		const { shelters, zones } = await generateAndParse();

		expect(zones[0].cells[H.zone_shelter_ref]).toBe('1');
		// The zone sheet no longer carries the 1:1 sheets' own header.
		expect(zones[0].cells[H.ref]).toBeUndefined();
		expect(zones.every((z) => z.ref === shelters[0].ref)).toBe(true);
	});

	it('still joins zones from a workbook using the old "ลำดับที่" zone header', async () => {
		const ExcelJS = (await import('exceljs')).default;
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(
			await (await buildShelterTemplateBlob(MASTERS, { withSample: true })).arrayBuffer()
		);
		wb.getWorksheet(ZONE_SHEET_NAME)!.getCell(1, 1).value = H.ref;

		const legacy = new File([await wb.xlsx.writeBuffer()], 'legacy.xlsx');
		const { zones } = await parseShelterWorkbook(legacy);

		expect(zones.length).toBeGreaterThan(0);
		expect(zones[0].ref).toBe('1');
		expect(zones[0].cells[H.zone_code]).toBeTruthy();
	});
});
