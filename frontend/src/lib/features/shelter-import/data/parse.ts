import { COLUMN_HEADERS } from '../domain/columns';
import type { RawRow } from '../domain/import-row';

/**
 * Parse an uploaded shelter-import `.xlsx` into raw rows (CR-039).
 *
 * The first worksheet's row 1 is the header; columns are matched to the known
 * Thai headers by exact text (unknown columns are ignored). Cell values are read
 * as display text (`cell.text`) and trimmed. Fully-empty rows are skipped so
 * trailing blank rows don't become phantom import errors.
 *
 * `exceljs` is dynamically imported (see `template.ts`) to keep it out of the
 * shared app bundle.
 */
export async function parseShelterWorkbook(file: File): Promise<RawRow[]> {
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(await file.arrayBuffer());
	const ws = wb.worksheets[0];
	if (!ws) return [];

	const headerToCol = new Map<string, number>();
	ws.getRow(1).eachCell((cell, col) => {
		const text = String(cell.text ?? '').trim();
		if (text) headerToCol.set(text, col);
	});

	const known = COLUMN_HEADERS.filter((h) => headerToCol.has(h));
	if (known.length === 0) return [];

	const rows: RawRow[] = [];
	for (let r = 2; r <= ws.rowCount; r++) {
		const row = ws.getRow(r);
		const raw: RawRow = {};
		let hasValue = false;
		for (const header of known) {
			const text = String(row.getCell(headerToCol.get(header)!).text ?? '').trim();
			raw[header] = text;
			if (text) hasValue = true;
		}
		if (hasValue) rows.push(raw);
	}
	return rows;
}
