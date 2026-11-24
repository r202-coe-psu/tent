import { getMealPeriodLabel } from './ticket-status';
import type { CoverageViewRow } from './meal-coverage-view';
import type { MealPeriod } from '../../domain/food-supplies';
import { MIN_MEALS_PER_DAY } from '../../domain/food-supplies/meal-coverage';

export const COVERAGE_CSV_HEADER = [
	'ชื่อ',
	'โซน',
	'มื้อที่มีบันทึก',
	'มื้อที่ยังไม่มีบันทึก',
	'ผู้แจก',
	'สถานะ',
	'ครัวเรือนมีบันทึกรับ',
	'จำนวนมื้อที่ได้รับ',
	`จำนวนวันที่ไม่ถึง ${MIN_MEALS_PER_DAY} มื้อ`,
	'จำนวนวันที่อยู่ในศูนย์ไม่เต็มวัน'
] as const;

type StatusRow = Pick<
	CoverageViewRow,
	'counted' | 'complete' | 'judgedDays' | 'shortDays' | 'partialDays'
>;

/**
 * For one day, "N/T" is meals on record over meals needed (capped at T), so a reader sees how far
 * short. Over a range (`multiDay`) it is the days short out of the days judged. Someone who was
 * in the shelter only part of the day is never judged.
 */
export function coverageStatusLabel(row: StatusRow, multiDay = false): string {
	if (row.judgedDays === 0) return 'อยู่ในศูนย์ไม่เต็มวัน';
	if (multiDay) {
		return row.complete
			? `รับครบเกณฑ์ทุกวัน (${row.judgedDays} วัน)`
			: `รับไม่ครบเกณฑ์ ${row.shortDays}/${row.judgedDays} วัน`;
	}
	const progress = `${Math.min(row.counted, MIN_MEALS_PER_DAY)}/${MIN_MEALS_PER_DAY}`;
	if (row.complete) return `รับครบเกณฑ์ · ${progress} มื้อ`;
	return row.counted === 0
		? 'รับไม่ครบเกณฑ์ · ยังไม่มีบันทึกรับ'
		: `รับไม่ครบเกณฑ์ · รับแล้ว ${progress} มื้อ`;
}

const USER_PREFIX = /^org\.couchdb\.user:/;
const PHONE_LIKE = /^\+?\d{9,}$/;

/** Staff may log in with a phone number: keep only its last 4 digits, the report carries no phones. */
export function distributorName(by: string): string {
	const name = by.replace(USER_PREFIX, '');
	return PHONE_LIKE.test(name) ? `•••${name.slice(-4)}` : name;
}

function distributorNames(row: Pick<CoverageViewRow, 'distributedBy'>): string {
	return [...new Set(row.distributedBy.map(distributorName))].join(', ');
}

/** Usernames of who handed the meals out, or a dash when no counting log names anyone. */
export function distributedByLabel(row: Pick<CoverageViewRow, 'distributedBy'>): string {
	return distributorNames(row) || '–';
}

export function mealList(meals: readonly MealPeriod[]): string {
	return meals.map(getMealPeriodLabel).join(', ');
}

function csvCell(value: string): string {
	// A leading = + - @ (or tab/CR) would run as a formula in a spreadsheet.
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return `"${safe.replace(/"/g, '""')}"`;
}

/** RFC 4180 CSV (CRLF) of the rows as listed; no BOM, `downloadCsv` adds it. */
export function coverageRowsToCsv(
	rows: readonly CoverageViewRow[],
	zoneName: (code: string | null) => string,
	multiDay = false
): string {
	const lines = rows.map((r) =>
		[
			r.name,
			zoneName(r.zone),
			mealList(r.received),
			mealList(r.missing),
			distributorNames(r),
			coverageStatusLabel(r, multiDay),
			mealList(r.householdRecorded),
			String(r.mealsReceived),
			r.judgedDays > 0 ? String(r.shortDays) : '',
			String(r.partialDays)
		]
			.map(csvCell)
			.join(',')
	);
	return [COVERAGE_CSV_HEADER.map(csvCell).join(','), ...lines].join('\r\n');
}

export function coverageCsvFilename(shelterCode: string, from: string, to: string = from): string {
	return `meal-coverage-${shelterCode}-${from === to ? from : `${from}_${to}`}.csv`;
}
