import type { CellValue } from '../domain/consulate-export';

/**
 * Shared exceljs -> Blob writer (CR-232 FR-7). Used by the consulate file and, later, the
 * dashboard numbers file (#1207). `exceljs` is ~1 MB, so it is imported on demand to stay
 * out of the main bundle (same approach as the people-import template).
 */

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface WorkbookSheet {
	/** Sheet tab name (Excel limit: 31 chars, none of `\ / ? * [ ] :`). */
	name: string;
	/** Rows of cells; `null` / `undefined` leaves the cell empty. */
	rows: readonly (readonly (CellValue | undefined)[])[];
	/** How many leading rows are the header (bold + frozen). Default 1; 0 for none. */
	headerRows?: number;
	/** Zero-based columns stamped as Text so Excel keeps leading zeros / long ids. */
	textColumns?: readonly number[];
}

export async function writeWorkbook(sheets: readonly WorkbookSheet[]): Promise<Blob> {
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	wb.creator = 'SmartShelter';
	for (const def of sheets) {
		const headerRows = def.headerRows ?? 1;
		const ws = wb.addWorksheet(def.name);
		const textCols = new Set(def.textColumns ?? []);
		def.rows.forEach((cells, r) => {
			const row = ws.addRow(cells.map((c) => c ?? null));
			if (r < headerRows) row.font = { bold: true };
			else
				for (const c of textCols) {
					const cell = row.getCell(c + 1);
					if (cell.value !== null) cell.numFmt = '@';
				}
		});
		const widest = Math.max(0, ...def.rows.map((r) => r.length));
		for (let c = 0; c < widest; c++) {
			const longest = Math.max(8, ...def.rows.map((r) => String(r[c] ?? '').length));
			ws.getColumn(c + 1).width = Math.min(longest + 2, 50);
		}
		if (headerRows > 0) ws.views = [{ state: 'frozen', ySplit: headerRows }];
	}
	const buffer = await wb.xlsx.writeBuffer();
	return new Blob([buffer], { type: XLSX_MIME_TYPE });
}
