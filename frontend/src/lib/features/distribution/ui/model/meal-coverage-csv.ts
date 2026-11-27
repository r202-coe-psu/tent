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
 * The row's status in the words of the summary cards, so the badge and the card it is counted
 * under read the same. Over a range (`multiDay`) a short row also says on how many of its judged
 * days it fell short. Someone who was in the shelter only part of the day is never judged.
 */
export function coverageStatusLabel(row: StatusRow, multiDay = false): string {
	if (row.judgedDays === 0) return 'อยู่ในศูนย์ไม่เต็มวัน';
	if (multiDay) {
		if (row.complete) return `รับ ${MIN_MEALS_PER_DAY} มื้อขึ้นไปทุกวัน (${row.judgedDays} วัน)`;
		return row.counted === 0
			? 'รับ 0 มื้อทั้งช่วง'
			: `รับไม่ถึง ${MIN_MEALS_PER_DAY} มื้อ ${row.shortDays} จาก ${row.judgedDays} วัน`;
	}
	if (row.complete) return `รับ ${MIN_MEALS_PER_DAY} มื้อขึ้นไป`;
	return row.counted === 0 ? 'รับ 0 มื้อ' : 'รับแค่ 1 มื้อ';
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
