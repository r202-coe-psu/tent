import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_SHEET_NAMES, type DashboardExportData } from '../domain/dashboard-sheets';
import { downloadBlob } from '../data/download';
import { dashboardFileName, exportDashboard, toWorkbookSheet } from './export-dashboard';

vi.mock('../data/download', () => ({ downloadBlob: vi.fn() }));

const range = { from: '2026-11-01', to: '2026-11-07' };

const DATA: DashboardExportData = {
	occupancy: {
		shelter_code: 'SH001',
		active: 2,
		room_confirmed: 3,
		deceased: 0,
		total: 10,
		in_shelter: 5,
		pre_registered: 1,
		kiosk_registered: 1,
		arriving: 1,
		temporary_leave: 0,
		transferred: 0,
		checked_out: 2
	},
	registrations: {
		shelter_code: 'SH001',
		total: 0,
		range,
		preregister: { '2026-11-01': 1 },
		checkin: {},
		checkout: {}
	},
	demographics: {
		shelter_code: 'SH001',
		age_groups: { '<1': 1, '1-5': 1, '6-11': 1, '12-19': 1, '20-59': 1, '60+': 1, unknown: 1 },
		countries: { TH: 3, UNKNOWN: 1 }
	},
	stationTimes: {
		shelter_code: 'SH001',
		range,
		stations: [
			{
				station: 1,
				channel: 'staff',
				visits: 2,
				timed_visits: 1,
				avg_duration_sec: 12.34,
				open_visits: 0
			}
		],
		actors: [
			{
				station: 1,
				actor_id: 'u1',
				kind: 'staff',
				display_name: 'สมชาย',
				timed_visits: 1,
				avg_duration_sec: 5
			}
		]
	}
};

describe('dashboardFileName', () => {
	it('formats code and +07 timestamp', () => {
		expect(dashboardFileName('SH001', new Date('2026-11-06T17:30:00Z'))).toBe(
			'dashboard-SH001-20261107-0030.xlsx'
		);
	});
});

describe('exportDashboard', () => {
	beforeEach(() => vi.mocked(downloadBlob).mockClear());

	it('downloads a workbook with the five dashboard sheets and returns the filename', async () => {
		const now = new Date('2026-11-06T17:30:00Z');
		const name = await exportDashboard(DATA, { code: 'SH001', name: 'ศูนย์ทดสอบ' }, now);

		expect(name).toBe('dashboard-SH001-20261107-0030.xlsx');
		expect(downloadBlob).toHaveBeenCalledTimes(1);
		const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
		expect(filename).toBe(name);
		expect(blob).toBeInstanceOf(Blob);

		const wb = new ExcelJS.Workbook();
		await wb.xlsx.load(await (blob as Blob).arrayBuffer());
		expect(wb.worksheets.map((w) => w.name)).toEqual([...DASHBOARD_SHEET_NAMES]);
		expect(wb.worksheets).toHaveLength(5);
		expect(wb.getWorksheet('KPI')!.getCell('A1').value).toContain('SH001');
	});
});

describe('toWorkbookSheet', () => {
	it('puts heading lines, a blank row, then columns and data; all but data is the header', () => {
		expect(
			toWorkbookSheet({ name: 'S', heading: ['h1', 'h2'], columns: ['a', 'b'], rows: [['x', 1]] })
		).toEqual({
			name: 'S',
			rows: [['h1'], ['h2'], [], ['a', 'b'], ['x', 1]],
			headerRows: 4
		});
	});

	it('omits the blank row when there is no heading', () => {
		const sheet = toWorkbookSheet({ name: 'S', heading: [], columns: ['a'], rows: [[1]] });
		expect(sheet.rows).toEqual([['a'], [1]]);
		expect(sheet.headerRows).toBe(1);
	});
});
