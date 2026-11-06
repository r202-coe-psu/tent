import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ExportSheet } from '../domain/export-sheet';
import { XLSX_MIME, writeWorkbook } from './write-workbook';

async function roundTrip(sheets: ExportSheet[]) {
	const blob = await writeWorkbook(sheets);
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(await blob.arrayBuffer());
	return { blob, wb };
}

const SHEETS: ExportSheet[] = [
	{
		name: 'KPI',
		heading: ['ศูนย์: ทดสอบ (SH001)', 'ช่วงวันที่: 2026-11-01 ถึง 2026-11-07'],
		columns: ['รายการ', 'จำนวน'],
		rows: [
			['ผู้เข้าพักทั้งหมด', 12],
			['ว่าง', null],
			['อัตรา (%)', 3.5]
		]
	},
	{ name: 'ลงทะเบียนรายวัน', heading: [], columns: ['วันที่', 'จำนวน'], rows: [['2026-11-01', 4]] },
	{ name: 'Empty', heading: ['h'], columns: ['a', 'b'], rows: [] }
];

describe('writeWorkbook', () => {
	it('returns an xlsx Blob', async () => {
		const { blob } = await roundTrip(SHEETS);
		expect(blob.type).toBe(XLSX_MIME);
		expect(blob.size).toBeGreaterThan(0);
	});

	it('preserves sheet names and order, including Thai names', async () => {
		const { wb } = await roundTrip(SHEETS);
		expect(wb.worksheets.map((w) => w.name)).toEqual(['KPI', 'ลงทะเบียนรายวัน', 'Empty']);
	});

	it('lays out heading, blank row, header, then data rows', async () => {
		const { wb } = await roundTrip(SHEETS);
		const ws = wb.getWorksheet('KPI')!;
		expect(ws.getCell('A1').value).toBe('ศูนย์: ทดสอบ (SH001)');
		expect(ws.getCell('A2').value).toBe('ช่วงวันที่: 2026-11-01 ถึง 2026-11-07');
		expect(ws.getCell('A3').value).toBeNull();
		expect(ws.getCell('A4').value).toBe('รายการ');
		expect(ws.getCell('B4').value).toBe('จำนวน');
		expect(ws.getCell('A5').value).toBe('ผู้เข้าพักทั้งหมด');
	});

	it('keeps numbers numeric, null empty, and Thai strings intact', async () => {
		const { wb } = await roundTrip(SHEETS);
		const ws = wb.getWorksheet('KPI')!;
		expect(ws.getCell('B5').value).toBe(12);
		expect(typeof ws.getCell('B5').value).toBe('number');
		expect(ws.getCell('B6').value).toBeNull();
		expect(ws.getCell('B7').value).toBe(3.5);
		expect(ws.getCell('A6').value).toBe('ว่าง');
	});

	it('puts the header in row 1 when the heading is empty', async () => {
		const { wb } = await roundTrip(SHEETS);
		const ws = wb.getWorksheet('ลงทะเบียนรายวัน')!;
		expect(ws.getCell('A1').value).toBe('วันที่');
		expect(ws.getCell('A2').value).toBe('2026-11-01');
		expect(ws.getCell('B2').value).toBe(4);
	});

	it('still writes the header for a sheet with zero data rows', async () => {
		const { wb } = await roundTrip(SHEETS);
		const ws = wb.getWorksheet('Empty')!;
		expect(ws.getCell('A3').value).toBe('a');
		expect(ws.getCell('B3').value).toBe('b');
		expect(ws.getCell('A4').value).toBeNull();
	});

	it('makes the header row bold', async () => {
		const { wb } = await roundTrip(SHEETS);
		expect(wb.getWorksheet('KPI')!.getCell('A4').font?.bold).toBe(true);
		expect(wb.getWorksheet('ลงทะเบียนรายวัน')!.getCell('A1').font?.bold).toBe(true);
	});
});
