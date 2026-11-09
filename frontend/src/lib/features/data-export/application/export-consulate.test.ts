import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { EVACUEE_SEARCH_I18N, type Evacuee } from '$lib/features/people';
import { CARD_TYPE_CHOICES, GENDER_CHOICES, RELIGION_CHOICES } from '$lib/features/people-import';
import { mixedRoster } from '../domain/evacuee.fixture';
import { CONSULATE_HEADERS, CONSULATE_SHEET_NAME } from '../domain/consulate-export';
import { writeWorkbook } from '../data/workbook';
import type { AuditEntry } from '$lib/features/shared';
import {
	ConsulateExportError,
	ConsulateExportForbiddenError,
	exportConsulateList,
	NoConsulateRowsError
} from './export-consulate';

const AUTHOR = { shelterCode: 'SH001', createdBy: 'manager@example.com' };
const LOOKUPS = {
	zones: [{ code: 'z1', name: 'โซน A' }],
	vulnerableGroups: [{ code: 'bedridden', label_th: 'ผู้ป่วยติดเตียง' }]
};

function harness(
	over: { writeAudit?: () => Promise<void>; listEvacuees?: () => Promise<Evacuee[]> } = {}
) {
	const downloads: { blob: Blob; name: string }[] = [];
	const audits: { shelterCode: string; entry: AuditEntry }[] = [];
	const deps = {
		listEvacuees: vi.fn(over.listEvacuees ?? (async () => mixedRoster())),
		writeAudit: vi.fn(
			over.writeAudit ??
				(async (shelterCode: string, entry: AuditEntry) => {
					audits.push({ shelterCode, entry });
				})
		),
		writeWorkbook, // the REAL exceljs writer
		download: vi.fn((blob: Blob, name: string) => {
			downloads.push({ blob, name });
		}),
		now: () => new Date('2026-11-06T17:09:00Z')
	};
	return { deps, downloads, audits };
}

const run = (deps: ReturnType<typeof harness>['deps'], country = ' myanmar ') =>
	exportConsulateList(
		{ shelterCode: 'SH001', country, author: AUTHOR, roles: ['system_admin'], lookups: LOOKUPS },
		deps
	);

describe('exportConsulateList (S5) — real export path', () => {
	it('downloads an xlsx that matches the spec cell for cell', async () => {
		const { deps, downloads } = harness();
		const result = await run(deps);

		expect(result).toEqual({
			fileName: 'consulate-SH001-MYANMAR-20261107-0009.xlsx',
			rowCount: 4
		});
		expect(downloads).toHaveLength(1);
		expect(downloads[0].name).toBe(result.fileName);

		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(await downloads[0].blob.arrayBuffer());
		expect(wb.worksheets.map((w) => w.name)).toEqual([CONSULATE_SHEET_NAME]);
		expect(CONSULATE_SHEET_NAME).toBe('รายชื่อผู้ประสบภัย');
		const ws = wb.worksheets[0];

		const cells = (r: number) =>
			Array.from({ length: CONSULATE_HEADERS.length }, (_, i) => ws.getRow(r).getCell(i + 1).value);
		expect(ws.rowCount).toBe(1 + 4);
		expect(cells(1)).toEqual([...CONSULATE_HEADERS]);

		const th = EVACUEE_SEARCH_I18N.th.statusLabels;
		const en = EVACUEE_SEARCH_I18N.en.statusLabels;
		const lbl = (c: { value: string; label: string }[], v: string) =>
			c.find((x) => x.value === v)!.label;

		// sorted by first then last name: Aung Aye, Aung Kyaw, Hla Doe, Zaw Min
		expect(cells(2)).toEqual([
			1,
			'Aung',
			'Aye',
			null,
			null,
			null,
			'MYANMAR',
			null,
			null,
			null,
			`${th.deceased} (${en.deceased})`,
			'2026-11-04 07:00',
			'z9',
			null,
			null,
			null,
			null,
			null,
			null
		]);
		expect(cells(3)).toEqual([
			2,
			'Aung',
			'Kyaw',
			lbl(GENDER_CHOICES, 'female'),
			null,
			30,
			'MYANMAR',
			null,
			null,
			null,
			`${th.checked_out} (${en.checked_out})`,
			'2026-11-04 00:30',
			null,
			null,
			null,
			null,
			'ผี',
			null,
			null
		]);
		expect(cells(4)).toEqual([
			3,
			'Hla',
			'Doe',
			null,
			null,
			null,
			'MYANMAR',
			null,
			null,
			null,
			`${th.transferred} (${en.transferred})`,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null
		]);
		expect(cells(5)).toEqual([
			4,
			'Zaw',
			'Min',
			lbl(GENDER_CHOICES, 'male'),
			2530,
			43,
			'MYANMAR',
			lbl(CARD_TYPE_CHOICES, 'passport'),
			'MA0123456',
			'0812345678',
			`${th.active} (${en.active})`,
			'2026-11-02 10:05',
			'โซน A',
			'Aye Min',
			'0899999999',
			'ภรรยา',
			lbl(RELIGION_CHOICES, 'buddhist'),
			'ผู้ป่วยติดเตียง,disability_other,ใช้ไม้เท้า',
			'อาหารเจ,ยาประจำตัว'
		]);

		// excluded people never appear anywhere in the sheet
		const all = JSON.stringify(ws.getSheetValues());
		for (const absent of ['PreReg', 'Kiosk', 'Cancelled', 'Purged', 'Somchai', 'John']) {
			expect(all).not.toContain(absent);
		}
	});

	it('writes the audit with action export / shelter / reason / {country,row_count} and no PII', async () => {
		const { deps, audits } = harness();
		await run(deps);

		expect(audits).toHaveLength(1);
		expect(audits[0].shelterCode).toBe('SH001');
		const a = audits[0].entry;
		expect(a).toMatchObject({
			type: 'audit',
			action: 'export',
			target_type: 'shelter',
			target_id: 'SH001',
			reason: 'consulate_export',
			context: { country: 'MYANMAR', row_count: 4 },
			shelter_code: 'SH001',
			created_by: 'manager@example.com'
		});
		expect(Object.keys(a.context ?? {}).sort()).toEqual(['country', 'row_count']);
		const json = JSON.stringify(a);
		for (const pii of ['Zaw', 'Min', 'Aung', 'MA0123456', '0812345678', 'Aye Min', 'ภรรยา']) {
			expect(json).not.toContain(pii);
		}
	});

	it('writes the audit before handing the file to download (FR-42 ordering)', async () => {
		const { deps } = harness();
		await run(deps);
		expect(deps.writeAudit.mock.invocationCallOrder[0]).toBeLessThan(
			deps.download.mock.invocationCallOrder[0]
		);
	});

	it('fail-closed: when the audit write fails, nothing is downloaded and the error propagates', async () => {
		const { deps, downloads } = harness({
			writeAudit: async () => {
				throw new Error('couch down');
			}
		});
		await expect(run(deps)).rejects.toThrow('บันทึก audit ไม่สำเร็จ');
		expect(deps.download).not.toHaveBeenCalled();
		expect(downloads).toHaveLength(0);
	});

	it('refuses (no audit, no file) when the country has no exportable people', async () => {
		const { deps, downloads } = harness();
		await expect(run(deps, 'THAILAND')).rejects.toBeInstanceOf(NoConsulateRowsError);
		expect(deps.writeAudit).not.toHaveBeenCalled();
		expect(downloads).toHaveLength(0);
	});

	it('names the stage that failed: reading evacuees is not reported as an audit failure', async () => {
		const { deps } = harness({
			listEvacuees: async () => {
				throw new Error('boom');
			}
		});
		const err = await run(deps).catch((e) => e);
		expect(err).toBeInstanceOf(ConsulateExportError);
		expect(err.message).toBe('อ่านรายชื่อผู้ประสบภัยไม่สำเร็จ');
		expect(deps.writeAudit).not.toHaveBeenCalled();
	});

	it('re-checks the role (FR-2): registration_staff and other-shelter managers are refused', async () => {
		for (const roles of [['SH001:registration_staff'], ['SH999:shelter_manager'], []]) {
			const { deps } = harness();
			await expect(
				exportConsulateList(
					{ shelterCode: 'SH001', country: 'MYANMAR', author: AUTHOR, roles, lookups: LOOKUPS },
					deps
				)
			).rejects.toBeInstanceOf(ConsulateExportForbiddenError);
			expect(deps.listEvacuees).not.toHaveBeenCalled();
			expect(deps.writeAudit).not.toHaveBeenCalled();
			expect(deps.download).not.toHaveBeenCalled();
		}
	});
});
