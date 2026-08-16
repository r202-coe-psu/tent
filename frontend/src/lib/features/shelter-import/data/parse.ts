import {
	H,
	MAIN_SHEET_NAME,
	normalizeHeader,
	SHELTER_SHEETS,
	SHEETS,
	ZONE_SHEET_NAME,
	type SheetDef
} from '../domain/columns';
import type { Worksheet } from 'exceljs';
import type { ParsedWorkbook, RawRow, RawSheetRow } from '../domain/import-row';

/**
 * Parse an uploaded shelter-import `.xlsx` into raw rows (CR-039).
 *
 * The workbook has five sheets (see `domain/columns.ts`): four 1:1 sheets whose
 * rows are merged into one row per shelter on the `ลำดับที่` join key, and the
 * N:1 `โซน` sheet whose rows are kept separate and carry that same key under the
 * clearer header `รหัสศูนย์พักพิง` (each sheet names its own via `refHeader`). Row 1 of each sheet is the
 * header; columns are matched to the known Thai headers by exact text once the
 * required-column "*" marker is stripped (see `normalizeHeader`; unknown
 * columns are ignored) and cell values are read as display text (`cell.text`)
 * and trimmed.
 *
 * A row counts as data only when at least one non-`ลำดับที่` cell is filled, so
 * the template's pre-numbered blank rows don't become phantom import errors.
 *
 * A workbook that has none of the named sheets falls back to reading the first
 * worksheet as the main sheet, so files made from an older single-sheet
 * template still import.
 *
 * `exceljs` is dynamically imported (see `template.ts`) to keep it out of the
 * shared app bundle.
 */

function readSheet(ws: Worksheet, sheet: SheetDef): RawSheetRow[] {
	const headerToCol = new Map<string, number>();
	ws.getRow(1).eachCell((cell, col) => {
		// Headers of required columns carry a trailing red "*" — strip it so the
		// cell still matches the bare header in `domain/columns.ts`.
		const text = normalizeHeader(String(cell.text ?? ''));
		if (text) headerToCol.set(text, col);
	});

	const known = sheet.columns.map((c) => c.header).filter((h) => headerToCol.has(h));
	if (known.length === 0) return [];

	// The zone sheet's join key used to be named `ลำดับที่` like the 1:1 sheets;
	// accept that header when the current one is absent so older files still join.
	const legacyRef = !headerToCol.has(sheet.refHeader) && headerToCol.has(H.ref);
	const refHeader = legacyRef ? H.ref : sheet.refHeader;
	if (legacyRef) known.push(H.ref);

	const rows: RawSheetRow[] = [];
	let line = 0;
	for (let r = 2; r <= ws.rowCount; r++) {
		const row = ws.getRow(r);
		const cells: RawRow = {};
		let hasValue = false;
		for (const header of known) {
			const text = String(row.getCell(headerToCol.get(header)!).text ?? '').trim();
			cells[header] = text;
			// The join key alone is not data — the template pre-fills it.
			if (text && header !== refHeader) hasValue = true;
		}
		line += 1;
		if (hasValue) rows.push({ ref: cells[refHeader] ?? '', line, cells });
	}
	return rows;
}

export async function parseShelterWorkbook(file: File): Promise<ParsedWorkbook> {
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(await file.arrayBuffer());

	const named = new Map<string, Worksheet>();
	for (const sheet of SHEETS) {
		const ws = wb.getWorksheet(sheet.name);
		if (ws) named.set(sheet.name, ws);
	}
	// Legacy single-sheet template: treat worksheet 1 as the main sheet.
	if (named.size === 0) {
		const first = wb.worksheets[0];
		if (!first) return { shelters: [], zones: [] };
		named.set(MAIN_SHEET_NAME, first);
	}

	const mainWs = named.get(MAIN_SHEET_NAME);
	if (!mainWs) return { shelters: [], zones: [] };

	const mainSheet = SHELTER_SHEETS.find((s) => s.name === MAIN_SHEET_NAME)!;
	const shelters = readSheet(mainWs, mainSheet);

	// Merge the other 1:1 sheets in by join key (falling back to position when
	// the main sheet's `ลำดับที่` was cleared).
	const byRef = new Map<string, RawSheetRow>();
	shelters.forEach((s, i) => byRef.set(s.ref === '' ? String(i + 1) : s.ref, s));

	for (const sheet of SHELTER_SHEETS) {
		if (sheet.name === MAIN_SHEET_NAME) continue;
		const ws = named.get(sheet.name);
		if (!ws) continue;
		for (const extra of readSheet(ws, sheet)) {
			const target = byRef.get(extra.ref);
			if (!target) continue;
			for (const [header, value] of Object.entries(extra.cells)) {
				if (header !== sheet.refHeader) target.cells[header] = value;
			}
		}
	}

	const zoneWs = named.get(ZONE_SHEET_NAME);
	const zoneSheet = SHEETS.find((s) => s.name === ZONE_SHEET_NAME)!;
	const zones = zoneWs ? readSheet(zoneWs, zoneSheet) : [];

	return { shelters, zones };
}
