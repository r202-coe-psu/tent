import {
	APP_ONLY_FIELDS,
	CSV_SHEET,
	H,
	isTextColumn,
	MEMBER_SHEET_NAME,
	MULTI_SEPARATOR,
	SHEETS,
	type ColumnDef,
	type EnumChoice,
	type MasterColumn
} from '../domain/columns';
import { buildSampleCsvRows, buildSampleWorkbook, type SampleWorkbook } from './sample-row';
import type { CellValue } from 'exceljs';

/**
 * Generate the people-import `.xlsx` template and its flat `.csv` twin
 * (CR-071 slice A / T-72).
 *
 * The workbook has three data sheets (see `domain/columns.ts`) joined on the
 * household's running number — `ลำดับที่` on the 1:1 sheets, `ลำดับที่ครัวเรือน`
 * on the member sheet — plus a `คำแนะนำ` README and a hidden `lists` sheet that
 * backs every dropdown. Dropdown option lists live on `lists` and are
 * referenced by range — Excel's inline list breaks on the commas and length of
 * the Thai labels. Cells store the human label; the importer resolves
 * label → code on upload.
 *
 * Required columns are marked by a red " *" appended inside the header cell
 * itself (no separate marker column) — see {@link headerValue}.
 *
 * The 1:1 sheets get their `ลำดับที่` column pre-filled 1..N so the join key is
 * correct by default; the parser ignores rows where only that column is set.
 * Multi-value columns get no dropdown — Excel data validation cannot express
 * multi-select — so their options are documented on the README instead.
 *
 * `exceljs` is ~1 MB with its own deps (jszip, saxes) and is only needed on
 * this one interactive action, so it is dynamically imported rather than pulled
 * into the shared app bundle via the feature barrel.
 */

/** Master-data option labels injected at download time. */
export type TemplateMasters = Record<MasterColumn, EnumChoice[]>;

/** Optional generator behaviour — `withSample` pre-fills a realistic example. */
export interface TemplateOptions {
	withSample?: boolean;
}

const DATA_ROWS = 200;
const HEADER_FILL_REQUIRED = 'FFFDE68A'; // amber — required columns
const HEADER_FILL_OPTIONAL = 'FFE5E7EB'; // grey — optional columns
const HEADER_FILL_KEY = 'FFBFDBFE'; // blue — the join key
const MARKER_FONT_COLOR = 'FFDC2626'; // red — required-column asterisk marker

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

/** The option labels backing a column's dropdown, or null when it has none. */
function choiceLabels(col: ColumnDef, masters: TemplateMasters): string[] | null {
	if (col.kind === 'enum') return col.choices?.map((c) => c.label) ?? null;
	if (col.kind === 'masterdata' && col.masterType)
		return masters[col.masterType].map((c) => c.label);
	return null;
}

/** Every option a column accepts — including multi-value ones (README only). */
function documentedOptions(col: ColumnDef, masters: TemplateMasters): string[] | null {
	if (col.kind === 'multi-enum') return col.choices?.map((c) => c.label) ?? null;
	return choiceLabels(col, masters);
}

function headerFillFor(col: ColumnDef): string {
	if (col.isRef) return HEADER_FILL_KEY;
	return col.required ? HEADER_FILL_REQUIRED : HEADER_FILL_OPTIONAL;
}

/**
 * Header cell content: the bare header, plus a red " *" run when the column is
 * required.
 *
 * exceljs flattens every rich-text run into `cell.text`, so a saved header
 * reads back as `"ชื่อ *"`. `parse.ts` runs that through `normalizeHeader`
 * (domain/columns.ts), which strips the trailing asterisk before matching, so
 * the marker rides inside the header cell without needing a separate column.
 */
function headerValue(col: ColumnDef): CellValue {
	if (!col.required) return col.header;
	return {
		richText: [
			{ text: col.header, font: { bold: true } },
			{ text: ' *', font: { bold: true, color: { argb: MARKER_FONT_COLOR } } }
		]
	};
}

/** Write one household/member's cell values into `row`, matched to columns by header text. */
function writeSampleRow(
	ws: import('exceljs').Worksheet,
	row: number,
	headerToCol: Map<string, number>,
	values: Record<string, string | number>
): void {
	for (const [header, value] of Object.entries(values)) {
		const col = headerToCol.get(header);
		if (col) ws.getCell(row, col).value = value;
	}
}

export async function buildPeopleTemplateBlob(
	masters: TemplateMasters,
	options?: TemplateOptions
): Promise<Blob> {
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	wb.creator = 'SmartShelter';
	const sample: SampleWorkbook | null = options?.withSample ? buildSampleWorkbook(masters) : null;

	// Hidden option lists — one column per dropdown, referenced by range.
	const lists = wb.addWorksheet('lists');
	lists.state = 'veryHidden';
	let listCol = 0;

	function listRange(labels: string[]): string {
		listCol += 1;
		const letter = colLetter(listCol);
		labels.forEach((label, r) => {
			lists.getCell(`${letter}${r + 1}`).value = label;
		});
		return `lists!$${letter}$1:$${letter}$${labels.length}`;
	}

	for (const sheet of SHEETS) {
		const ws = wb.addWorksheet(sheet.name);
		// Every non-numeric column is stamped Text (`@`). Without it Excel parses
		// what the user types: `0800000000` becomes 800000000 (leading zero lost)
		// and a 13-digit ID turns into scientific notation.
		ws.columns = sheet.columns.map((c, i) => ({
			header: c.header,
			key: `c${i}`,
			width: c.isRef ? 18 : 24,
			style: isTextColumn(c.kind) ? { numFmt: '@' } : {}
		}));
		// header text → 1-based column index, for the sample rows below.
		const headerToCol = new Map(sheet.columns.map((c, i) => [c.header, i + 1] as const));

		const headerRow = ws.getRow(1);
		headerRow.height = 34;
		sheet.columns.forEach((col, i) => {
			const cell = headerRow.getCell(i + 1);
			cell.value = headerValue(col);
			cell.font = { bold: true };
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerFillFor(col) } };
			cell.note = col.hint;
		});
		ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

		// Dropdowns — applied as one validation per column range.
		sheet.columns.forEach((col, i) => {
			const labels = choiceLabels(col, masters);
			if (!labels || labels.length === 0) return;
			const range = listRange(labels);
			const physicalCol = i + 1;
			for (let r = 2; r <= DATA_ROWS + 1; r++) {
				ws.getCell(r, physicalCol).dataValidation = {
					type: 'list',
					allowBlank: true,
					formulae: [range]
				};
			}
		});

		// Pre-number the join key on the 1:1 sheets so it lines up by default.
		if (sheet.kind === 'household') {
			for (let r = 2; r <= DATA_ROWS + 1; r++) ws.getCell(r, 1).value = r - 1;
		}

		// Pre-fill the example household, matched to columns by header text rather
		// than by position.
		if (sample) {
			if (sheet.kind === 'household') {
				writeSampleRow(ws, 2, headerToCol, sample.household);
			} else {
				sample.members.forEach((member, i) => {
					const row = i + 2;
					const refCol = headerToCol.get(sheet.refHeader);
					if (refCol) ws.getCell(row, refCol).value = 1;
					writeSampleRow(ws, row, headerToCol, member);
				});
			}
		}
	}

	// README sheet.
	const readme = wb.addWorksheet('คำแนะนำ');
	readme.columns = [
		{ header: 'ชีต', key: 'sheet', width: 24 },
		{ header: 'คอลัมน์', key: 'h', width: 34 },
		{ header: 'จำเป็น', key: 'req', width: 10 },
		{ header: 'คำอธิบาย / ตัวเลือก', key: 'hint', width: 90 }
	];
	readme.getRow(1).font = { bold: true };
	readme.getColumn('hint').alignment = { wrapText: true, vertical: 'top' };

	readme.addRow({
		sheet: 'วิธีใช้',
		h: H.ref,
		req: 'ใช่',
		hint:
			`ชีต "ครัวเรือน" และ "ที่อยู่และทรัพย์สิน" ผูกกันด้วย "${H.ref}" — ` +
			'แถวที่ 1 ของชีต "ครัวเรือน" คือครัวเรือนลำดับที่ 1 ' +
			`ชีตอื่นที่มี "${H.ref}" = 1 จะถูกรวมเข้าเป็นครัวเรือนเดียวกัน / ` +
			`ช่องที่เลือกได้หลายค่าให้คั่นด้วย "${MULTI_SEPARATOR}"`
	});

	readme.addRow({
		sheet: 'วิธีใช้',
		h: H.member_household_ref,
		req: 'ใช่',
		hint:
			`ชีต "${MEMBER_SHEET_NAME}" ใช้ "${H.member_household_ref}" แทน "${H.ref}" — ` +
			`ให้กรอกเลข "${H.ref}" ของครัวเรือนที่สมาชิกคนนั้นสังกัด (ไม่ใช่ลำดับของสมาชิก) ` +
			'เช่น ทุกสมาชิกของครัวเรือนลำดับที่ 1 ให้กรอก 1 ทุกแถว — ' +
			'ไม่ต้องใส่หัวหน้าครัวเรือนซ้ำในชีตนี้'
	});

	readme.addRow({
		sheet: 'วิธีใช้',
		h: 'เครื่องหมาย *',
		req: '-',
		hint: 'หัวคอลัมน์ที่ลงท้ายด้วย * สีแดง = ช่องที่จำเป็นต้องกรอก (ห้ามลบเครื่องหมายออกจากหัวคอลัมน์)'
	});

	readme.addRow({
		sheet: 'วิธีใช้',
		h: 'ศูนย์พักพิงปลายทาง',
		req: '-',
		hint: 'ทุกแถวจะถูกนำเข้าศูนย์พักพิงที่เปิดอยู่บนหน้าจอตอนกดนำเข้า — ไฟล์นี้จึงไม่มีคอลัมน์รหัสศูนย์ ถ้าต้องการนำเข้าอีกศูนย์ ให้สลับศูนย์ก่อนแล้วอัปโหลดไฟล์ของศูนย์นั้น'
	});

	readme.addRow({
		sheet: 'วิธีใช้',
		h: 'สถานะหลังนำเข้า',
		req: '-',
		hint: 'ทุกครัวเรือนที่นำเข้าสำเร็จจะได้สถานะ "ลงทะเบียนล่วงหน้า" และยังไม่นับเป็นผู้เข้าพัก จนกว่าจะเช็คอินที่ประตูหรือเจ้าหน้าที่เปลี่ยนสถานะให้ — ไฟล์นี้จึงไม่มีคอลัมน์สถานะ'
	});

	readme.addRow({
		sheet: 'วิธีใช้',
		h: 'ข้อมูลที่ไม่มีในไฟล์นี้',
		req: '-',
		hint: `${APP_ONLY_FIELDS.join(' / ')} — ตั้งค่าในระบบหลังนำเข้าเสร็จ`
	});

	for (const sheet of SHEETS) {
		readme.addRow({ sheet: sheet.name, h: '—', req: '', hint: sheet.description }).font = {
			bold: true
		};
		for (const col of sheet.columns) {
			// The 1:1 sheets share one join key, documented once under "วิธีใช้"; the
			// member sheet's is the column people get wrong, so it keeps its own row.
			if (col.isRef && sheet.kind === 'household') continue;
			const colOptions = documentedOptions(col, masters);
			let hint = col.hint;
			if (colOptions) {
				hint = colOptions.length
					? `${col.hint} — ตัวเลือก: ${colOptions.join(' / ')}`
					: `${col.hint} — (ยังไม่มีข้อมูลตั้งต้น)`;
			}
			readme.addRow({
				sheet: sheet.name,
				h: col.header,
				req: col.required ? 'ใช่' : '-',
				hint
			});
		}
	}

	const buffer = await wb.xlsx.writeBuffer();
	return new Blob([buffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
}

/** Quote a CSV field only when it needs it, doubling any embedded quote. */
function csvField(value: string | number): string {
	const s = String(value ?? '');
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The flat CSV template — same contract, one table (see {@link CSV_SHEET}).
 *
 * A CSV carries no dropdowns, notes or formatting, so the required-column
 * marker rides in the header text as a plain " *" (the parser strips it the
 * same way) and the options live only in the workbook's README. Written with a
 * UTF-8 BOM so Excel opens the Thai headers as UTF-8 instead of mojibake.
 */
export function buildPeopleCsvTemplateBlob(
	masters: TemplateMasters,
	options?: TemplateOptions
): Blob {
	const headers = CSV_SHEET.columns.map((c) => (c.required ? `${c.header} *` : c.header));
	const lines = [headers.map(csvField).join(',')];

	if (options?.withSample) {
		for (const row of buildSampleCsvRows(masters)) {
			lines.push(CSV_SHEET.columns.map((c) => csvField(row[c.header] ?? '')).join(','));
		}
	}

	return new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
}
