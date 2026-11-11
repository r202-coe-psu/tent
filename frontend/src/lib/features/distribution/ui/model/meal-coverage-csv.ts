import { getMealPeriodLabel } from './ticket-status';
import type { CoverageViewRow } from './meal-coverage-view';
import type { MealPeriod } from '../../domain/food-supplies';

export const COVERAGE_CSV_HEADER = [
	'ชื่อ',
	'โซน',
	'มื้อที่มีบันทึก',
	'มื้อที่ยังไม่มีบันทึก',
	'สถานะ',
	'ครัวเรือนมีบันทึกรับ'
] as const;

export function coverageStatusLabel(row: Pick<CoverageViewRow, 'received'>): string {
	return row.received.length === 0 ? 'ยังไม่มีบันทึก' : `มีบันทึก ${row.received.length} มื้อ`;
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
	zoneName: (code: string | null) => string
): string {
	const lines = rows.map((r) =>
		[
			r.name,
			zoneName(r.zone),
			mealList(r.received),
			mealList(r.missing),
			coverageStatusLabel(r),
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
