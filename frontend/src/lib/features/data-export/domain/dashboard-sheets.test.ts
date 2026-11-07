import { describe, expect, it } from 'vitest';
import {
	buildDashboardSheets,
	DASHBOARD_SHEET_NAMES,
	type DashboardExportData
} from './dashboard-sheets';
import type { ExportMeta } from './export-sheet';

const meta: ExportMeta = {
	shelterCode: 'SH-001',
	shelterName: 'ศูนย์ทดสอบ',
	exportedAt: new Date('2026-11-06T17:30:00Z')
};

const data = (): DashboardExportData => ({
	occupancy: {
		shelter_code: 'SH-001',
		pre_registered: 10,
		kiosk_registered: 5,
		arriving: 7,
		active: 20,
		room_confirmed: 30,
		in_shelter: 50,
		temporary_leave: 3,
		transferred: 2,
		checked_out: 25,
		deceased: 0,
		total: 100
	},
	registrations: {
		shelter_code: 'SH-001',
		range: { from: '2026-11-01', to: '2026-11-05' },
		preregister: { '2026-11-03': 4 },
		checkin: { '2026-11-02': 6, '2026-11-03': 8 },
		checkout: { '2026-11-05': 2, '2026-11-02': 1 },
		total: 21
	},
	demographics: {
		shelter_code: 'SH-001',
		age_groups: { '<1': 1, '1-5': 2, '6-11': 3, '12-19': 4, '20-59': 50, '60+': 20, unknown: 5 },
		countries: { ATLANTIS: 6, UNKNOWN: 3, ELDORADO: 1 }
	},
	stationTimes: {
		shelter_code: 'SH-001',
		range: { from: '2026-10-20', to: '2026-10-25' },
		stations: [
			{
				station: 1,
				channel: 'staff',
				visits: 10,
				timed_visits: 8,
				avg_duration_sec: 61.26,
				open_visits: 1
			},
			{
				station: 1,
				channel: 'kiosk',
				visits: 4,
				timed_visits: 0,
				avg_duration_sec: null,
				open_visits: 0
			},
			{
				station: 2,
				channel: 'staff',
				visits: 9,
				timed_visits: 9,
				avg_duration_sec: 120,
				open_visits: 2
			},
			{
				station: 3,
				channel: 'staff',
				visits: 7,
				timed_visits: 7,
				avg_duration_sec: 30.04,
				open_visits: 0
			}
		],
		actors: [
			{
				station: 1,
				actor_id: 'a',
				kind: 'staff',
				display_name: 'สมชาย',
				timed_visits: 5,
				avg_duration_sec: 40.55
			},
			{
				station: 1,
				actor_id: 'b',
				kind: 'kiosk',
				display_name: 'ตู้ K1',
				timed_visits: 3,
				avg_duration_sec: 90
			},
			{
				station: 2,
				actor_id: 'c',
				kind: 'staff',
				display_name: 'สมหญิง',
				timed_visits: 9,
				avg_duration_sec: 120
			}
		]
	}
});

const byName = (name: string, d = data(), m = meta) =>
	buildDashboardSheets(d, m).find((s) => s.name === name)!;

describe('buildDashboardSheets', () => {
	it('returns exactly six sheets in the fixed order', () => {
		const sheets = buildDashboardSheets(data(), meta);
		expect(sheets).toHaveLength(6);
		expect(sheets.map((s) => s.name)).toEqual([
			'KPI',
			'ลงทะเบียนรายวัน',
			'ช่วงอายุ',
			'สัญชาติ',
			'เวลาบริการต่อจุด',
			'อันดับเจ้าหน้าที่'
		]);
		expect([...DASHBOARD_SHEET_NAMES]).toEqual(sheets.map((s) => s.name));
	});

	it('uses the expected column headers per sheet', () => {
		const cols = Object.fromEntries(
			buildDashboardSheets(data(), meta).map((s) => [s.name, s.columns])
		);
		expect(cols['KPI']).toEqual(['รายการ', 'จำนวน']);
		expect(cols['ลงทะเบียนรายวัน']).toEqual([
			'วันที่',
			'จำนวนผู้ลงทะเบียนล่วงหน้า',
			'จำนวนคนลงทะเบียนเข้า',
			'จำนวนคนลงทะเบียนออก'
		]);
		expect(cols['ช่วงอายุ']).toEqual(['ช่วงอายุ', 'จำนวน']);
		expect(cols['สัญชาติ']).toEqual(['ประเทศ', 'จำนวน', 'สัดส่วน (%)']);
		expect(cols['เวลาบริการต่อจุด']).toEqual([
			'จุดบริการ',
			'ช่องทาง',
			'ให้บริการแล้ว (ราย)',
			'ให้บริการที่จับเวลาได้ (ราย)',
			'เวลาเฉลี่ย (วินาที)',
			'กำลังให้บริการ (ราย)'
		]);
		expect(cols['อันดับเจ้าหน้าที่']).toEqual([
			'จุดบริการ',
			'อันดับ',
			'ชื่อ',
			'ประเภท',
			'ให้บริการ (ราย)',
			'เวลาเฉลี่ย (วินาที)'
		]);
	});

	it('puts shelter name+code, a range line and the +07 export time in every heading', () => {
		for (const s of buildDashboardSheets(data(), meta)) {
			expect(s.heading).toHaveLength(3);
			expect(s.heading[0]).toBe('ศูนย์: ศูนย์ทดสอบ (SH-001)');
			expect(s.heading[1]).toContain('ช่วงวันที่:');
			expect(s.heading[2]).toBe('Export เมื่อ: 2026-11-07 00:30 (+07)');
		}
	});

	it('falls back to the shelter code when the name is missing or blank', () => {
		for (const shelterName of [null, undefined, '   ']) {
			const s = buildDashboardSheets(data(), { ...meta, shelterName })[0];
			expect(s.heading[0]).toBe('ศูนย์: SH-001');
		}
	});

	it('every row has as many cells as there are columns', () => {
		for (const s of buildDashboardSheets(data(), meta)) {
			for (const row of s.rows) expect(row).toHaveLength(s.columns.length);
		}
	});

	describe('range lines', () => {
		it('snapshot sheets carry the snapshot note', () => {
			for (const name of ['KPI', 'ช่วงอายุ', 'สัญชาติ']) {
				const line = byName(name).heading[1];
				expect(line).toContain('ข้อมูลสถานะปัจจุบัน ไม่ขึ้นกับช่วงวันที่');
			}
		});

		it('registration sheet uses the registrations range', () => {
			expect(byName('ลงทะเบียนรายวัน').heading[1]).toBe('ช่วงวันที่: 2026-11-01 ถึง 2026-11-05');
		});

		it('station sheets use stationTimes.range, not the registrations range', () => {
			for (const name of ['เวลาบริการต่อจุด', 'อันดับเจ้าหน้าที่']) {
				const line = byName(name).heading[1];
				expect(line).toBe('ช่วงวันที่: 2026-10-20 ถึง 2026-10-25');
				expect(line).not.toContain('2026-11-01');
			}
		});
	});

	describe('KPI', () => {
		it('lists the eight figures with derived values', () => {
			expect(byName('KPI').rows).toEqual([
				['ผู้เข้าพักทั้งหมด', 100],
				['อยู่ในศูนย์อพยพ', 50],
				['รอเข้าพัก (ลงทะเบียนล่วงหน้า/ที่ตู้)', 15],
				['รายงานตัวแล้ว (รอคัดกรอง/จัดที่พัก)', 7],
				['ออกชั่วคราว', 3],
				['ย้ายไปศูนย์อพยพอื่น', 2],
				['ออกจากศูนย์อพยพแล้ว', 25],
				['อัตรากลับบ้าน (%)', 25]
			]);
		});

		it('rounds the return rate to a whole percent', () => {
			const d = data();
			d.occupancy.total = 3;
			d.occupancy.checked_out = 1;
			expect(byName('KPI', d).rows.at(-1)).toEqual(['อัตรากลับบ้าน (%)', 33]);
			d.occupancy.checked_out = 2;
			expect(byName('KPI', d).rows.at(-1)).toEqual(['อัตรากลับบ้าน (%)', 67]);
		});

		it('returns 0 when the total is 0', () => {
			const d = data();
			d.occupancy.total = 0;
			d.occupancy.checked_out = 0;
			expect(byName('KPI', d).rows.at(-1)).toEqual(['อัตรากลับบ้าน (%)', 0]);
		});
	});

	describe('daily registrations', () => {
		it('lists every day of the range ascending, zero-filling days with no movement', () => {
			expect(byName('ลงทะเบียนรายวัน').rows).toEqual([
				['2026-11-01', 0, 0, 0],
				['2026-11-02', 0, 6, 1],
				['2026-11-03', 4, 8, 0],
				['2026-11-04', 0, 0, 0],
				['2026-11-05', 0, 0, 2]
			]);
		});

		it('still lists every day, all zero, when nothing moved', () => {
			const d = data();
			d.registrations.preregister = {};
			d.registrations.checkin = {};
			d.registrations.checkout = {};
			expect(byName('ลงทะเบียนรายวัน', d).rows).toHaveLength(5);
			expect(byName('ลงทะเบียนรายวัน', d).rows.every((r) => r.slice(1).every((n) => n === 0))).toBe(
				true
			);
		});
	});

	describe('age groups', () => {
		it('lists every bucket in AGE_BUCKETS order with Thai labels', () => {
			expect(byName('ช่วงอายุ').rows).toEqual([
				['ทารก (< 1 ปี)', 1],
				['เด็กเล็ก (1–5 ปี)', 2],
				['เด็กโต (6–11 ปี)', 3],
				['วัยรุ่น (12–19 ปี)', 4],
				['ผู้ใหญ่ (20–59 ปี)', 50],
				['ผู้สูงอายุ (60 ปีขึ้นไป)', 20],
				['ไม่ระบุ', 5]
			]);
		});
	});

	describe('countries', () => {
		it('sorts by count desc, labels UNKNOWN, and gives percent to one decimal', () => {
			// total 10 -> 60 / 30 / 10
			expect(byName('สัญชาติ').rows).toEqual([
				['ATLANTIS', 6, 60],
				['ไม่ระบุ', 3, 30],
				['ELDORADO', 1, 10]
			]);
		});

		it('translates real country codes to Thai names', () => {
			const d = data();
			d.demographics.countries = { THAILAND: 2, JAPAN: 1 };
			expect(byName('สัญชาติ', d).rows).toEqual([
				['ไทย', 2, 66.7],
				['ญี่ปุ่น', 1, 33.3]
			]);
		});

		it('rounds percent to 1 decimal', () => {
			const d = data();
			d.demographics.countries = { ATLANTIS: 2, ELDORADO: 1 };
			expect(byName('สัญชาติ', d).rows).toEqual([
				['ATLANTIS', 2, 66.7],
				['ELDORADO', 1, 33.3]
			]);
		});

		it('breaks count ties by code', () => {
			const d = data();
			d.demographics.countries = { BBB: 1, AAA: 1 };
			expect(byName('สัญชาติ', d).rows.map((r) => r[0])).toEqual(['AAA', 'BBB']);
		});

		it('has no rows when there are no countries', () => {
			const d = data();
			d.demographics.countries = {};
			expect(byName('สัญชาติ', d).rows).toEqual([]);
		});
	});

	describe('station times', () => {
		it('labels stations and channels, nulls missing averages, rounds to 1 decimal', () => {
			expect(byName('เวลาบริการต่อจุด').rows).toEqual([
				['Station 1 รายงานตัว / ลงทะเบียน', 'เจ้าหน้าที่', 10, 8, 61.3, 1],
				['Station 1 รายงานตัว / ลงทะเบียน', 'ตู้ kiosk', 4, 0, null, 0],
				['Station 2 คัดกรองสุขภาพ', 'เจ้าหน้าที่', 9, 9, 120, 2],
				['Station 3 จัดโซนที่พัก', 'เจ้าหน้าที่', 7, 7, 30, 0]
			]);
		});
	});

	describe('actor rank', () => {
		it('restarts rank at 1 per station and rounds seconds', () => {
			expect(byName('อันดับเจ้าหน้าที่').rows).toEqual([
				['Station 1 รายงานตัว / ลงทะเบียน', 1, 'สมชาย', 'เจ้าหน้าที่', 5, 40.6],
				['Station 1 รายงานตัว / ลงทะเบียน', 2, 'ตู้ K1', 'ตู้ kiosk', 3, 90],
				['Station 2 คัดกรองสุขภาพ', 1, 'สมหญิง', 'เจ้าหน้าที่', 9, 120]
			]);
		});

		it('has no rows without actors', () => {
			const d = data();
			d.stationTimes.actors = [];
			expect(byName('อันดับเจ้าหน้าที่', d).rows).toEqual([]);
		});
	});

	it('contains no evacuee-level fields', () => {
		const text = JSON.stringify(buildDashboardSheets(data(), meta));
		for (const k of [
			'national_id',
			'passport',
			'phone',
			'birth',
			'first_name',
			'last_name',
			'actor_id'
		]) {
			expect(text).not.toContain(k);
		}
		for (const s of buildDashboardSheets(data(), meta)) {
			expect(s.columns.join('|')).not.toMatch(/เลขบัตร|เบอร์|ชื่อ-สกุล/);
		}
	});
});
