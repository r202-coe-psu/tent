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
	'ครัวเรือนมีบันทึกรับ'
] as const;

/** "N/T" is meals on record over meals needed (capped at T), so a reader sees how far short. */
export function coverageStatusLabel(
	row: Pick<CoverageViewRow, 'counted' | 'complete'>,
	threshold: number = MIN_MEALS_PER_DAY
): string {
	const progress = `${Math.min(row.counted, threshold)}/${threshold}`;
	return row.complete ? `ครบ ${progress} มื้อ` : `ยังไม่ถึง ${threshold} มื้อ · ${progress}`;
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
	threshold: number = MIN_MEALS_PER_DAY
): string {
	const lines = rows.map((r) =>
		[
			r.name,
			zoneName(r.zone),
			mealList(r.received),
			mealList(r.missing),
			distributorNames(r),
			coverageStatusLabel(r, threshold),
			mealList(r.householdRecorded)
		]
			.map(csvCell)
			.join(',')
	);
	return [COVERAGE_CSV_HEADER.map(csvCell).join(','), ...lines].join('\r\n');
}

export function coverageCsvFilename(shelterCode: string, day: string): string {
	return `meal-coverage-${shelterCode}-${day}.csv`;
}
