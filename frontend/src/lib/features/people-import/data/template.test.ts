import { describe, expect, it } from 'vitest';
import { H, normalizeHeader } from '../domain/columns';
import { emptyLookups, validateWorkbook } from '../domain/import-row';
import { parsePeopleWorkbook } from './parse';
import {
	buildPeopleCsvTemplateBlob,
	buildPeopleTemplateBlob,
	type TemplateMasters
} from './template';

const EMPTY_MASTERS: TemplateMasters = {};

async function generateAndParse(masters: TemplateMasters = EMPTY_MASTERS) {
	const blob = await buildPeopleTemplateBlob(masters, { withSample: true });
	const file = new File([await blob.arrayBuffer()], 'template.xlsx');
	return parsePeopleWorkbook(file);
}

describe('normalizeHeader', () => {
	it('strips the required marker from a header cell', () => {
		expect(normalizeHeader('ชื่อ *')).toBe('ชื่อ');
		expect(normalizeHeader(' ปีเกิด (พ.ศ.)  * ')).toBe('ปีเกิด (พ.ศ.)');
	});

	it('leaves an unmarked header untouched', () => {
		expect(normalizeHeader('จังหวัด')).toBe('จังหวัด');
	});
});

describe('xlsx template → parse round trip', () => {
	it('reads back required columns whose header carries the "*" marker', async () => {
		const { households, members } = await generateAndParse();

		expect(households).toHaveLength(1);
		expect(households[0].cells[H.first_name]).toBeTruthy();
		expect(households[0].cells[H.gender]).toBeTruthy();
		// A column from the second 1:1 sheet — proves the merge still joins on ลำดับที่.
		expect(households[0].cells[H.address_no]).toBeTruthy();

		expect(members.length).toBeGreaterThan(0);
		expect(members[0].cells[H.first_name]).toBeTruthy();
	});

	it('joins member rows through the "ลำดับที่ครัวเรือน" column', async () => {
		const { households, members } = await generateAndParse();

		expect(members[0].cells[H.member_household_ref]).toBe('1');
		expect(members.every((m) => m.ref === households[0].ref)).toBe(true);
	});

	it('produces a sample workbook that imports without a single error', async () => {
		const rows = validateWorkbook(await generateAndParse(), emptyLookups());

		expect(rows).toHaveLength(1);
		expect(rows[0].errors).toEqual([]);
		expect(rows[0].ok).toBe(true);
		expect(rows[0].memberCount).toBe(3);
	});

	it('keeps a leading-zero phone number as text instead of a number', async () => {
		const { households } = await generateAndParse();
		expect(households[0].cells[H.phone]).toBe('0812345678');
	});

	it('falls back to the first worksheet when the sheets were renamed', async () => {
		const ExcelJS = (await import('exceljs')).default;
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(
			await (await buildPeopleTemplateBlob(EMPTY_MASTERS, { withSample: true })).arrayBuffer()
		);
		wb.worksheets.forEach((ws, i) => (ws.name = `Sheet${i + 1}`));

		const renamed = new File([await wb.xlsx.writeBuffer()], 'renamed.xlsx');
		const { households } = await parsePeopleWorkbook(renamed);

		expect(households).toHaveLength(1);
		expect(households[0].cells[H.first_name]).toBeTruthy();
	});

	it('always pre-fills free-text zone and community in the sample (CR-137)', async () => {
		const { households } = await generateAndParse();
		expect(households[0].cells[H.municipality_zone]).toBe('เขตเทศบาลนครหาดใหญ่ 1');
		expect(households[0].cells[H.community]).toBe('ชุมชนริมน้ำ');
	});
});

describe('csv template → parse round trip', () => {
	async function parseCsvTemplate(masters: TemplateMasters = EMPTY_MASTERS) {
		const blob = buildPeopleCsvTemplateBlob(masters, { withSample: true });
		return parsePeopleWorkbook(new File([await blob.text()], 'template.csv'));
	}

	it('groups the flat rows back into one household with its members', async () => {
		const { households, members } = await parseCsvTemplate();

		expect(households).toHaveLength(1);
		expect(households[0].cells[H.first_name]).toBe('สมชาย');
		expect(members).toHaveLength(3);
	});

	it('produces the same importable household as the workbook', async () => {
		const rows = validateWorkbook(await parseCsvTemplate(), emptyLookups());

		expect(rows[0].errors).toEqual([]);
		expect(rows[0].ok).toBe(true);
		expect(rows[0].memberCount).toBe(3);
		expect(rows[0].payload?.household.address_no).toBe('99/1');
	});

	it('reads the household columns from the head row only', async () => {
		const { members } = await parseCsvTemplate();
		// The members' own address cells are blank in the flat file.
		expect(members[0].cells[H.address_no]).toBe('');
	});
});

describe('csv template shape', () => {
	it('marks required columns in the header text so the parser strips them back', async () => {
		const text = await buildPeopleCsvTemplateBlob(EMPTY_MASTERS).text();
		const header = text.replace(/^\uFEFF/, '').split('\r\n')[0];

		expect(header).toContain(`${H.first_name} *`);
		expect(header.split(',')[0]).toContain(H.ref);
		expect(header).toContain(H.role);
		// The household's own columns ride along on the flat row too.
		expect(header).toContain(H.municipality_zone);
	});
});

describe('README lists master-backed free-text options (CR-186 FR-10)', () => {
	async function readmeHint(masters: TemplateMasters): Promise<string> {
		const ExcelJS = (await import('exceljs')).default;
		const wb = new ExcelJS.Workbook();
		const blob = await buildPeopleTemplateBlob(masters);
		await wb.xlsx.load(await blob.arrayBuffer());
		const readme = wb.getWorksheet('คำแนะนำ');
		let hint = '';
		readme?.eachRow((row) => {
			if (!hint && row.getCell(2).text === H.medical_conditions) hint = row.getCell(4).text;
		});
		return hint;
	}

	it('lists the active chronic diseases next to the โรคประจำตัว column', async () => {
		const hint = await readmeHint({
			medical_conditions: [
				{ value: 'diabetes', label: 'เบาหวาน' },
				{ value: 'asthma', label: 'หอบหืด' }
			]
		});

		expect(hint).toContain('เบาหวาน / หอบหืด');
		expect(hint).toContain('พิมพ์ชื่อโรคอื่นได้');
	});

	it('keeps the plain hint when no master list is passed', async () => {
		const hint = await readmeHint(EMPTY_MASTERS);

		expect(hint).not.toContain('รายการ:');
	});
});

describe('Backfill Import columns (#1399)', () => {
	const ZONES: TemplateMasters = {
		zone: [
			{ value: 'A', label: 'โซน A' },
			{ value: 'B', label: 'โซน B' }
		]
	};

	async function loadTemplate(masters: TemplateMasters) {
		const ExcelJS = (await import('exceljs')).default;
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(await (await buildPeopleTemplateBlob(masters)).arrayBuffer());
		return wb;
	}

	it('adds สถานะ / เวลามา / เวลากลับ / โซน to the head sheet, the member sheet and the CSV', async () => {
		const wb = await loadTemplate(EMPTY_MASTERS);
		for (const sheetName of ['ครัวเรือน', 'สมาชิก']) {
			const headers: string[] = [];
			wb.getWorksheet(sheetName)!
				.getRow(1)
				.eachCell((c) => headers.push(normalizeHeader(c.text)));
			expect(headers).toEqual(
				expect.arrayContaining([H.stay_status, H.arrived_at, H.departed_at, H.zone])
			);
		}
		const csvHeader = (await buildPeopleCsvTemplateBlob(EMPTY_MASTERS).text())
			.replace(/^\uFEFF/, '')
			.split('\r\n')[0];
		expect(csvHeader).toContain(`${H.stay_status} *`);
		expect(csvHeader).toContain(`${H.arrived_at} *`);
		expect(csvHeader).toContain(H.departed_at);
	});

	it('gives สถานะ a พักอยู่/กลับแล้ว dropdown and โซน a dropdown of the shelter zones', async () => {
		const wb = await loadTemplate(ZONES);
		const ws = wb.getWorksheet('ครัวเรือน')!;
		const col = (header: string) => {
			let idx = 0;
			ws.getRow(1).eachCell((c, i) => {
				if (normalizeHeader(c.text) === header) idx = i;
			});
			return idx;
		};
		const lists = wb.getWorksheet('lists')!;
		const listValues = (formula: string) => {
			const [, letter, lastRow] = /\$([A-Z]+)\$1:\$[A-Z]+\$(\d+)/.exec(formula)!;
			const out: string[] = [];
			for (let r = 1; r <= Number(lastRow); r++) out.push(lists.getCell(`${letter}${r}`).text);
			return out;
		};
		const dv = (header: string) => ws.getCell(2, col(header)).dataValidation;

		expect(listValues(dv(H.stay_status).formulae![0])).toEqual(['พักอยู่', 'กลับแล้ว']);
		expect(listValues(dv(H.zone).formulae![0])).toEqual(['โซน A', 'โซน B']);
		// Dates are free typing — no dropdown, and stamped Text so Excel keeps the wall-clock.
		expect(dv(H.arrived_at)).toBeUndefined();
		expect(ws.getColumn(col(H.arrived_at)).numFmt).toBe('@');
	});

	it('has no zone dropdown when the shelter zones are unknown', async () => {
		const wb = await loadTemplate(EMPTY_MASTERS);
		const ws = wb.getWorksheet('ครัวเรือน')!;
		let zoneCol = 0;
		ws.getRow(1).eachCell((c, i) => {
			if (normalizeHeader(c.text) === H.zone) zoneCol = i;
		});
		expect(ws.getCell(2, zoneCol).dataValidation).toBeUndefined();
	});

	it('writes a sample that imports cleanly against the shelter zones, using a real zone name', async () => {
		const blob = await buildPeopleTemplateBlob(ZONES, { withSample: true });
		const wb = await parsePeopleWorkbook(new File([await blob.arrayBuffer()], 't.xlsx'));
		expect(wb.households[0].cells[H.zone]).toBe('โซน A');

		const rows = validateWorkbook(wb, {
			zones: [
				{ code: 'A', name: 'โซน A' },
				{ code: 'B', name: 'โซน B' }
			],
			now: new Date('2026-11-15T05:00:00.000Z')
		});
		expect(rows[0].errors).toEqual([]);
		// One sample member has already left, one household member is still housed.
		expect(rows[0].payload?.members.map((m) => m.stay.status)).toContain('checked_out');
		expect(rows[0].payload?.household.status).toBe('checked_in');
	});

	it('skips a closed first zone when picking the sample zone', async () => {
		const masters: TemplateMasters = {
			zone: [
				{ value: 'X', label: 'โซน X (ปิด)', inactive: true },
				{ value: 'A', label: 'โซน A' }
			]
		};
		const blob = await buildPeopleTemplateBlob(masters, { withSample: true });
		const wb = await parsePeopleWorkbook(new File([await blob.arrayBuffer()], 't.xlsx'));
		expect(wb.households[0].cells[H.zone]).toBe('โซน A');

		const rows = validateWorkbook(wb, {
			zones: [
				{ code: 'X', name: 'โซน X (ปิด)', status: 'closed' },
				{ code: 'A', name: 'โซน A', status: 'active' }
			],
			now: new Date('2026-11-15T05:00:00.000Z')
		});
		expect(rows[0].errors).toEqual([]);
	});

	it('documents the stay columns and the Backfill Import purpose on the README', async () => {
		const wb = await loadTemplate(EMPTY_MASTERS);
		const text: string[] = [];
		wb.getWorksheet('คำแนะนำ')!.eachRow((row) => text.push(row.getCell(4).text));
		const all = text.join('\n');

		expect(all).toContain('Backfill Import');
		expect(all).toContain('ไม่เลยเวลาปัจจุบัน');
		// Stay status and zone moved into the file — only the photo is still "app only".
		expect(all).not.toContain('สถานะการเข้าพัก');
		expect(all).toContain('รูปถ่ายผู้ประสบภัย');
	});

	it('reads a real spreadsheet date cell back as the file text format (Excel Text format overridden)', async () => {
		const wb = await loadTemplate(EMPTY_MASTERS);
		const ws = wb.getWorksheet('ครัวเรือน')!;
		let col = 0;
		ws.getRow(1).eachCell((c, i) => {
			if (normalizeHeader(c.text) === H.arrived_at) col = i;
		});
		ws.getCell(2, 3).value = 'สมชาย'; // any data cell so the row counts
		ws.getCell(2, col).value = new Date(Date.UTC(2026, 10, 10, 14, 0));
		// A user who re-formats the cell as a date (instead of Text) gets a real date back.
		ws.getCell(2, col).numFmt = 'dd/mm/yyyy hh:mm';
		const buffer = await wb.xlsx.writeBuffer();

		const parsed = await parsePeopleWorkbook(new File([buffer], 'dates.xlsx'));
		expect(parsed.households[0].cells[H.arrived_at]).toBe('10/11/2569 14:00');
	});
});
