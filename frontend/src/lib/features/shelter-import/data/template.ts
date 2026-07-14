import ExcelJS from 'exceljs';
import { COLUMNS, type EnumChoice, type MasterColumn } from '../domain/columns';

/**
 * Generate the shelter-import `.xlsx` template (CR-039).
 *
 * Sheet 1 (`ศูนย์พักพิง`) holds the 19-column header row plus data-validation
 * dropdowns for the enum + master-data columns. Dropdown option lists live in a
 * hidden `lists` sheet and are referenced by range — Excel's inline list breaks
 * on the commas and length of the Thai labels. A second `คำแนะนำ` sheet
 * documents each field. Cells store the human label; the importer resolves
 * label → code on upload.
 */

/** Master-data option labels injected at download time. */
export type TemplateMasters = Record<MasterColumn, EnumChoice[]>;

const DATA_ROWS = 500;
const HEADER_FILL_REQUIRED = 'FFFDE68A'; // amber — required columns
const HEADER_FILL_OPTIONAL = 'FFE5E7EB'; // grey — optional columns

function colLetter(n: number): string {
	let s = '';
	let x = n;
	while (x > 0) {
		const mod = (x - 1) % 26;
		s = String.fromCharCode(65 + mod) + s;
		x = Math.floor((x - 1) / 26);
	}
	return s;
}

export async function buildShelterTemplateBlob(masters: TemplateMasters): Promise<Blob> {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'SmartShelter';

	const ws = wb.addWorksheet('ศูนย์พักพิง');
	ws.columns = COLUMNS.map((c, i) => ({ header: c.header, key: `c${i}`, width: 22 }));

	// Hidden option lists — one list per column, referenced by range.
	const lists = wb.addWorksheet('lists');
	lists.state = 'veryHidden';

	// Map each dropdown column (0-based data column index) → a `lists!$X$1:$X$n` range.
	const dropdownRange = new Map<number, string>();
	let listCol = 0;
	COLUMNS.forEach((col, i) => {
		let labels: string[] | null = null;
		if (col.kind === 'enum' && col.choices) labels = col.choices.map((c) => c.label);
		else if (col.kind === 'masterdata' && col.masterType)
			labels = masters[col.masterType].map((c) => c.label);
		if (!labels || labels.length === 0) return;
		listCol += 1;
		const letter = colLetter(listCol);
		labels.forEach((label, r) => {
			lists.getCell(`${letter}${r + 1}`).value = label;
		});
		dropdownRange.set(i, `lists!$${letter}$1:$${letter}$${labels.length}`);
	});

	// Style the header row + mark required columns.
	const headerRow = ws.getRow(1);
	headerRow.height = 24;
	COLUMNS.forEach((col, i) => {
		const cell = headerRow.getCell(i + 1);
		cell.font = { bold: true };
		cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
		cell.fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: col.required ? HEADER_FILL_REQUIRED : HEADER_FILL_OPTIONAL }
		};
		if (col.required) cell.note = 'จำเป็นต้องกรอก';
	});

	// Apply dropdown data validation to the data rows.
	dropdownRange.forEach((range, colIndex) => {
		for (let r = 2; r <= DATA_ROWS + 1; r++) {
			ws.getCell(r, colIndex + 1).dataValidation = {
				type: 'list',
				allowBlank: true,
				formulae: [range]
			};
		}
	});

	// README sheet.
	const readme = wb.addWorksheet('คำแนะนำ');
	readme.columns = [
		{ header: 'คอลัมน์', key: 'h', width: 26 },
		{ header: 'จำเป็น', key: 'req', width: 10 },
		{ header: 'คำอธิบาย / ตัวเลือก', key: 'hint', width: 70 }
	];
	readme.getRow(1).font = { bold: true };
	COLUMNS.forEach((col) => {
		let hint = col.hint;
		if (col.kind === 'enum' && col.choices)
			hint = `${col.hint} — ตัวเลือก: ${col.choices.map((c) => c.label).join(' / ')}`;
		else if (col.kind === 'masterdata' && col.masterType) {
			const opts = masters[col.masterType].map((c) => c.label).join(' / ');
			hint = `${col.hint}${opts ? ` — ตัวเลือก: ${opts}` : ' — (ยังไม่มีข้อมูลตั้งต้น)'}`;
		}
		readme.addRow({ h: col.header, req: col.required ? 'ใช่' : '-', hint });
	});

	const buffer = await wb.xlsx.writeBuffer();
	return new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
}
