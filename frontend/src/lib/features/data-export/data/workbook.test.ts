import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { writeWorkbook, XLSX_MIME_TYPE } from './workbook';

async function load(blob: Blob) {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(await blob.arrayBuffer());
	return wb;
}

describe('writeWorkbook (S4, FR-7)', () => {
	it('returns an xlsx Blob with one sheet per definition, names kept in order', async () => {
		const blob = await writeWorkbook([
			{ name: 'KPI', rows: [['a'], [1]] },
			{ name: 'ช่วงอายุ', rows: [['b']] }
		]);
		expect(blob.type).toBe(XLSX_MIME_TYPE);
		const wb = await load(blob);
		expect(wb.worksheets.map((w) => w.name)).toEqual(['KPI', 'ช่วงอายุ']);
	});

	it('writes strings and numbers as typed values and null as an empty cell', async () => {
		const wb = await load(
			await writeWorkbook([
				{
					name: 'S',
					rows: [
						['h1', 'h2', 'h3'],
						['x', 5, null]
					]
				}
			])
		);
		const row = wb.getWorksheet('S')!.getRow(2);
		expect(row.getCell(1).value).toBe('x');
		expect(row.getCell(2).value).toBe(5);
		expect(row.getCell(3).value).toBeNull();
	});

	it('keeps leading zeros in text columns and bolds + freezes the header', async () => {
		const wb = await load(
			await writeWorkbook([{ name: 'S', rows: [['phone'], ['0812345678']], textColumns: [0] }])
		);
		const ws = wb.getWorksheet('S')!;
		expect(ws.getCell('A2').value).toBe('0812345678');
		expect(ws.getCell('A2').numFmt).toBe('@');
		expect(ws.getCell('A1').font?.bold).toBe(true);
		expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
	});
});
