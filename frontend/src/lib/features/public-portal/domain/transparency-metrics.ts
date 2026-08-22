export type BirthYearViewRow = {
	key: unknown;
	value: unknown;
};

/**
 * Stay statuses that hold a place at a shelter (CR-070 D-BOOK-OCC=C, FR-66).
 *
 * A web booking reserves the seat the moment it is made, so `pre_registered`
 * counts toward public occupancy alongside `active`. `cancelled` and every other
 * status are excluded. Kitchen/SOP head-counts stay `active`-only (CR-022).
 */
export const OCCUPANCY_STATUSES = ['active', 'pre_registered'] as const;

/**
 * Sum the `occupancy` view rows that hold a place.
 *
 * The view emits one row per `current_stay.status`; unknown keys (`cancelled`,
 * `checked_out`, …) are discarded rather than added.
 */
export function sumOccupancyFromStatusRows(rows: unknown): number {
	if (!Array.isArray(rows)) return 0;

	let occupancy = 0;
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const { key, value } = row as { key: unknown; value: unknown };
		if (typeof key !== 'string') continue;
		if (!(OCCUPANCY_STATUSES as readonly string[]).includes(key)) continue;
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
		occupancy += value;
	}

	return occupancy;
}

/** CouchDB stores birth_year as a Buddhist Era year in this view. */
export function isValidThaiBirthYear(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 2400 && value < 2600;
}

export function countVulnerableFromBirthYearRows(
	rows: unknown,
	currentYear = new Date().getFullYear()
): number {
	if (!Array.isArray(rows)) return 0;

	let vulnerableCount = 0;

	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const viewRow = row as BirthYearViewRow;
		if (!isValidThaiBirthYear(viewRow.key)) continue;

		const age = currentYear - (viewRow.key - 543);
		if (
			(age <= 4 || age >= 60) &&
			typeof viewRow.value === 'number' &&
			Number.isFinite(viewRow.value) &&
			viewRow.value >= 0
		) {
			vulnerableCount += viewRow.value;
		}
	}

	return vulnerableCount;
}
