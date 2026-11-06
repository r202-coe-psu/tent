/**
 * domain/dashboard-sheets.ts — data-export (CR-232 §C, issue #1207)
 *
 * Pure: the figures the evacuee dashboard shows → six numeric sheets. No evacuee-level data,
 * so nothing here is PII and no audit entry is written (FR-54).
 */
import {
	AGE_BUCKETS,
	AGE_BUCKET_LABELS,
	type DemographicsPayload,
	type OccupancyPayload,
	type RegistrationsPayload,
	type StationTimesPayload
} from '$lib/features/dashboard';
import { getCountryName } from '$lib/utils/country';
import { buildDateRange } from '$lib/utils/date';
import { headingTimestamp } from './export-time';
import type { ExportCell, ExportMeta, ExportSheet } from './export-sheet';

/** Fixed sheet names and order (FR-52). */
export const DASHBOARD_SHEET_NAMES = [
	'KPI',
	'ลงทะเบียนรายวัน',
	'ช่วงอายุ',
	'สัญชาติ',
	'เวลาบริการต่อจุด',
	'อันดับเจ้าหน้าที่'
] as const;

export interface DashboardExportData {
	occupancy: OccupancyPayload;
	registrations: RegistrationsPayload;
	demographics: DemographicsPayload;
	stationTimes: StationTimesPayload;
}

const STATION_LABELS: Record<1 | 2 | 3, string> = {
	1: 'Station 1 รายงานตัว / ลงทะเบียน',
	2: 'Station 2 คัดกรองสุขภาพ',
	3: 'Station 3 จัดโซนที่พัก'
};
const CHANNEL_LABELS = { staff: 'เจ้าหน้าที่', kiosk: 'ตู้ kiosk' } as const;

const SNAPSHOT_NOTE = 'ข้อมูลสถานะปัจจุบัน ไม่ขึ้นกับช่วงวันที่';

function rangeText(range: { from: string; to: string }): string {
	return `ช่วงวันที่: ${range.from} ถึง ${range.to}`;
}

function heading(meta: ExportMeta, rangeLine: string): string[] {
	const name = meta.shelterName?.trim();
	return [
		`ศูนย์: ${name ? `${name} (${meta.shelterCode})` : meta.shelterCode}`,
		rangeLine,
		`Export เมื่อ: ${headingTimestamp(meta.exportedAt)} (+07)`
	];
}

/** Seconds to one decimal; empty when there is no timed visit. */
function seconds(value: number | null): ExportCell {
	return value === null ? null : Math.round(value * 10) / 10;
}

/** Mirrors the KPI cards on screen, same labels and same derived values. */
function kpiRows(o: OccupancyPayload): ExportCell[][] {
	const returnRate = o.total > 0 ? Math.round((o.checked_out / o.total) * 100) : 0;
	return [
		['ผู้เข้าพักทั้งหมด', o.total],
		['อยู่ในศูนย์อพยพ', o.in_shelter],
		['รอเข้าพัก (ลงทะเบียนล่วงหน้า/ที่ตู้)', o.pre_registered + o.kiosk_registered],
		['รายงานตัวแล้ว (รอคัดกรอง/จัดที่พัก)', o.arriving],
		['ออกชั่วคราว', o.temporary_leave],
		['ย้ายไปศูนย์อพยพอื่น', o.transferred],
		['ออกจากศูนย์อพยพแล้ว', o.checked_out],
		['อัตรากลับบ้าน (%)', returnRate]
	];
}

/** One row per calendar day of the range, zero-filled — the same days the chart draws. */
function registrationRows(r: RegistrationsPayload): ExportCell[][] {
	return buildDateRange(r.range.from, r.range.to).map((d) => [
		d,
		r.preregister[d] ?? 0,
		r.checkin[d] ?? 0,
		r.checkout[d] ?? 0
	]);
}

/** Countries largest first (ties by code), the order the nationality card uses. */
function countryRows(countries: DemographicsPayload['countries']): ExportCell[][] {
	const total = Object.values(countries).reduce((sum, n) => sum + n, 0);
	return Object.entries(countries)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([code, count]) => [
			code === 'UNKNOWN' ? 'ไม่ระบุ' : getCountryName(code),
			count,
			total > 0 ? Math.round((count / total) * 1000) / 10 : 0
		]);
}

/**
 * The six dashboard sheets, in {@link DASHBOARD_SHEET_NAMES} order.
 *
 * `meta` supplies shelter and export time; each sheet's range line comes from the payload it
 * was fetched with, so a sheet never claims a range its numbers don't cover.
 */
export function buildDashboardSheets(
	data: DashboardExportData,
	meta: ExportMeta
): readonly ExportSheet[] {
	const { occupancy, registrations, demographics, stationTimes } = data;
	const snapshot = heading(meta, `${rangeText(registrations.range)} · ${SNAPSHOT_NOTE}`);
	const timesHeading = heading(meta, rangeText(stationTimes.range));

	return [
		{
			name: 'KPI',
			heading: snapshot,
			columns: ['รายการ', 'จำนวน'],
			rows: kpiRows(occupancy)
		},
		{
			name: 'ลงทะเบียนรายวัน',
			heading: heading(meta, rangeText(registrations.range)),
			columns: [
				'วันที่',
				'จำนวนผู้ลงทะเบียนล่วงหน้า',
				'จำนวนคนลงทะเบียนเข้า',
				'จำนวนคนลงทะเบียนออก'
			],
			rows: registrationRows(registrations)
		},
		{
			name: 'ช่วงอายุ',
			heading: snapshot,
			columns: ['ช่วงอายุ', 'จำนวน'],
			rows: AGE_BUCKETS.map((b) => [AGE_BUCKET_LABELS[b], demographics.age_groups[b]])
		},
		{
			name: 'สัญชาติ',
			heading: snapshot,
			columns: ['ประเทศ', 'จำนวน', 'สัดส่วน (%)'],
			rows: countryRows(demographics.countries)
		},
		{
			name: 'เวลาบริการต่อจุด',
			heading: timesHeading,
			columns: [
				'จุดบริการ',
				'ช่องทาง',
				'ให้บริการแล้ว (ราย)',
				'ให้บริการที่จับเวลาได้ (ราย)',
				'เวลาเฉลี่ย (วินาที)',
				'กำลังให้บริการ (ราย)'
			],
			rows: stationTimes.stations.map((s) => [
				STATION_LABELS[s.station],
				CHANNEL_LABELS[s.channel],
				s.visits,
				s.timed_visits,
				seconds(s.avg_duration_sec),
				s.open_visits
			])
		},
		{
			name: 'อันดับเจ้าหน้าที่',
			heading: timesHeading,
			columns: ['จุดบริการ', 'อันดับ', 'ชื่อ', 'ประเภท', 'ให้บริการ (ราย)', 'เวลาเฉลี่ย (วินาที)'],
			rows: rankRows(stationTimes)
		}
	];
}

/** Rank restarts at 1 per station; the BFF already orders fastest first within a station. */
function rankRows(t: StationTimesPayload): ExportCell[][] {
	const rank: Record<number, number> = {};
	return t.actors.map((a) => {
		rank[a.station] = (rank[a.station] ?? 0) + 1;
		return [
			STATION_LABELS[a.station],
			rank[a.station],
			a.display_name,
			CHANNEL_LABELS[a.kind],
			a.timed_visits,
			seconds(a.avg_duration_sec)
		];
	});
}
