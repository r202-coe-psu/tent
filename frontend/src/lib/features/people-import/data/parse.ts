import {
	ADDRESS_SHEET_NAME,
	CSV_SHEET,
	H,
	HOUSEHOLD_SHEETS,
	MAIN_SHEET_NAME,
	MEMBER_SHEET_NAME,
	normalizeHeader,
	ROLE_CHOICES,
	SHEETS,
	type SheetDef
} from '../domain/columns';
import type { Worksheet } from 'exceljs';
import type { ParsedWorkbook, RawRow, RawSheetRow } from '../domain/import-row';

/**
 * Parse an uploaded people-import `.xlsx` or `.csv` into raw rows
 * (CR-071 slice A / T-72).
 *
 * The workbook has three sheets (see `domain/columns.ts`): two 1:1 sheets whose
 * rows are merged into one row per household on the `ลำดับที่` join key, and
 * the N:1 `สมาชิก` sheet whose rows are kept separate and carry that same key
 * under the clearer header `ลำดับที่ครัวเรือน` (each sheet names its own via
 * `refHeader`). Row 1 of each sheet is the header; columns are matched to the
 * known Thai headers by exact text once the required-column "*" marker is
 * stripped (see `normalizeHeader`; unknown columns are ignored) and cell values
 * are read as display text (`cell.text`) and trimmed.
 *
 * A row counts as data only when at least one non-`ลำดับที่` cell is filled, so
 * the template's pre-numbered blank rows don't become phantom import errors.
 *
 * A CSV cannot carry sheets, so it uses the flat layout ({@link CSV_SHEET}):
 * one row per person, grouped by `ลำดับที่`, with `บทบาท` naming the head. Both
 * formats produce the same {@link ParsedWorkbook}, so nothing downstream knows
 * which one was uploaded.
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
			if (text && header !== sheet.refHeader) hasValue = true;
		}
		line += 1;
		if (hasValue) rows.push({ ref: cells[sheet.refHeader] ?? '', line, cells });
	}
	return rows;
}

async function parseXlsx(file: File): Promise<ParsedWorkbook> {
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(await file.arrayBuffer());

	const named = new Map<string, Worksheet>();
	for (const sheet of SHEETS) {
		const ws = wb.getWorksheet(sheet.name);
		if (ws) named.set(sheet.name, ws);
	}
	const mainSheet = HOUSEHOLD_SHEETS.find((s) => s.name === MAIN_SHEET_NAME)!;

	// A file whose sheets were renamed: fall back to the first worksheet that
	// actually carries household headers, so a salvaged or re-saved file still
	// imports its heads. Picking worksheet 1 blindly would land on the hidden
	// `lists` sheet the template ships for its dropdowns.
	const mainWs =
		named.get(MAIN_SHEET_NAME) ?? wb.worksheets.find((ws) => readSheet(ws, mainSheet).length > 0);
	if (!mainWs) return { households: [], members: [] };

	const households = readSheet(mainWs, mainSheet);

	// Merge the address sheet in by join key (falling back to position when the
	// household sheet's `ลำดับที่` was cleared).
	const byRef = new Map<string, RawSheetRow>();
	households.forEach((h, i) => byRef.set(h.ref === '' ? String(i + 1) : h.ref, h));

	const addressWs = named.get(ADDRESS_SHEET_NAME);
	const addressSheet = HOUSEHOLD_SHEETS.find((s) => s.name === ADDRESS_SHEET_NAME)!;
	if (addressWs) {
		for (const extra of readSheet(addressWs, addressSheet)) {
			const target = byRef.get(extra.ref);
			if (!target) continue;
			for (const [header, value] of Object.entries(extra.cells)) {
				if (header !== addressSheet.refHeader) target.cells[header] = value;
			}
		}
	}

	const memberWs = named.get(MEMBER_SHEET_NAME);
	const memberSheet = SHEETS.find((s) => s.name === MEMBER_SHEET_NAME)!;
	const members = memberWs ? readSheet(memberWs, memberSheet) : [];

	return { households, members };
}

// ===== CSV =====

/**
 * Minimal RFC 4180 reader: comma-separated, `"` quoting with `""` escapes, and
 * either line ending. Enough for what Excel and Google Sheets export, and small
 * enough not to justify a dependency.
 */
export function parseCsvText(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	// Strip the UTF-8 BOM Excel writes, or the first header never matches.
	const src = text.replace(/^\uFEFF/, '');

	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (quoted) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += ch;
			continue;
		}
		if (ch === '"') quoted = true;
		else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && src[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += ch;
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

const HEAD_ROLE_LABELS = new Set(
	ROLE_CHOICES.filter((c) => c.value === 'head').flatMap((c) => [c.value, c.label])
);

/**
 * Flat CSV → the same shape the workbook produces.
 *
 * Rows are grouped by `ลำดับที่`. Within a group the head is the row whose
 * `บทบาท` says so, or the first row when none does; every other row becomes a
 * member. A second head row in the same group is imported as a member rather
 * than starting a rival household — the preview lists it either way.
 */
async function parseCsv(file: File): Promise<ParsedWorkbook> {
	const table = parseCsvText(await file.text());
	if (table.length < 2) return { households: [], members: [] };

	const headers = table[0].map((h) => normalizeHeader(h));
	const known = new Map<string, number>();
	CSV_SHEET.columns.forEach((c) => {
		const idx = headers.indexOf(c.header);
		if (idx !== -1) known.set(c.header, idx);
	});
	if (known.size === 0) return { households: [], members: [] };

	interface CsvRow {
		ref: string;
		line: number;
		cells: RawRow;
		isHead: boolean;
	}
	const rows: CsvRow[] = [];
	table.slice(1).forEach((cols, i) => {
		const cells: RawRow = {};
		let hasValue = false;
		for (const [header, idx] of known) {
			const text = (cols[idx] ?? '').trim();
			cells[header] = text;
			if (text && header !== H.ref && header !== H.role) hasValue = true;
		}
		if (!hasValue) return;
		rows.push({
			ref: cells[H.ref] ?? '',
			line: i + 1,
			cells,
			isHead: HEAD_ROLE_LABELS.has(cells[H.role] ?? '')
		});
	});

	// Group by join key, preserving file order. A blank key falls back to the
	// row's own position so one un-numbered person still imports as a household.
	const groups = new Map<string, CsvRow[]>();
	for (const row of rows) {
		const key = row.ref === '' ? `#${row.line}` : row.ref;
		const list = groups.get(key);
		if (list) list.push(row);
		else groups.set(key, [row]);
	}

	const households: RawSheetRow[] = [];
	const members: RawSheetRow[] = [];
	let householdLine = 0;
	for (const [key, group] of groups) {
		const head = group.find((r) => r.isHead) ?? group[0];
		householdLine += 1;
		households.push({ ref: key, line: householdLine, cells: head.cells });
		for (const row of group) {
			if (row === head) continue;
			members.push({ ref: key, line: row.line, cells: row.cells });
		}
	}
	return { households, members };
}

export function isCsvFile(file: File): boolean {
	return file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
}

export async function parsePeopleWorkbook(file: File): Promise<ParsedWorkbook> {
	return isCsvFile(file) ? parseCsv(file) : parseXlsx(file);
}
