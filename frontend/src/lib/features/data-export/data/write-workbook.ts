/**
 * data/write-workbook.ts — data-export (CR-232 FR-7)
 *
 * The single `ExportSheet[]` → `.xlsx` Blob writer, shared by the dashboard and consulate exports.
 * `exceljs` is ~1 MB, so it is imported on demand rather than pulled into the shared bundle.
 */
import type { ExportSheet } from '../domain/export-sheet';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const HEADER_FILL = 'FFE5E7EB';

export async function writeWorkbook(sheets: readonly ExportSheet[]): Promise<Blob> {
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();

	for (const sheet of sheets) {
		const ws = wb.addWorksheet(sheet.name);
		for (const line of sheet.heading) ws.addRow([line]).font = { bold: true };
		if (sheet.heading.length > 0) ws.addRow([]);

		const header = ws.addRow([...sheet.columns]);
		header.font = { bold: true };
		header.eachCell((cell) => {
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
		});
		for (const row of sheet.rows) ws.addRow([...row]);

		sheet.columns.forEach((title, i) => {
			const longest = sheet.rows.reduce((max, r) => Math.max(max, String(r[i] ?? '').length), 0);
			ws.getColumn(i + 1).width = Math.min(Math.max(title.length, longest) + 2, 50);
		});
	}

	const buffer = await wb.xlsx.writeBuffer();
	return new Blob([buffer], { type: XLSX_MIME });
}
