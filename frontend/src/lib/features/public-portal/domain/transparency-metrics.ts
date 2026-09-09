export type BirthYearViewRow = {
	key: unknown;
	value: unknown;
};

export type OccupancyTriple = {
	/** Forecast headcount — seats expected to be held (CR-112). */
	occupancy: number;
	/** Present headcount — arrived at shelter (incl. temporary leave). */
	present: number;
	/** In-zone headcount — Zone Arrival Confirmation (`room_confirmed`) only. */
	in_zone: number;
};

/**
 * Forecast Occupancy stay statuses (CR-112).
 *
 * Public `occupancy` means Forecast. Kitchen/SOP head-counts stay `active`-only
 * (CR-022) and are not derived from this allow-list.
 */
export const FORECAST_OCCUPANCY_STATUSES = [
	'pre_registered',
	'arriving',
	'active',
	'room_confirmed',
	'temporary_leave'
] as const;

/** Present Occupancy — Evacuees who have arrived at the shelter. */
export const PRESENT_OCCUPANCY_STATUSES = ['active', 'room_confirmed', 'temporary_leave'] as const;

/** In-zone Occupancy — Zone Arrival Confirmation only. */
export const IN_ZONE_OCCUPANCY_STATUSES = ['room_confirmed'] as const;

/**
 * Alias: public `occupancy` key = Forecast (CR-112 supersedes CR-070 D-BOOK-OCC=C).
 */
export const OCCUPANCY_STATUSES = FORECAST_OCCUPANCY_STATUSES;

function sumCountsForStatuses(rows: unknown, statuses: readonly string[]): number {
	if (!Array.isArray(rows)) return 0;

	let total = 0;
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const { key, value } = row as { key: unknown; value: unknown };
		if (typeof key !== 'string') continue;
		if (!statuses.includes(key)) continue;
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
		total += value;
	}

	return total;
}

/**
 * Sum Forecast Occupancy from `occupancy` view rows (`occupancy` response key).
 *
 * Unknown keys (`cancelled`, `checked_out`, …) are discarded rather than added.
 */
export function sumOccupancyFromStatusRows(rows: unknown): number {
	return sumCountsForStatuses(rows, FORECAST_OCCUPANCY_STATUSES);
}

/** Sum Present Occupancy from status-grouped view rows. */
export function sumPresentFromStatusRows(rows: unknown): number {
	return sumCountsForStatuses(rows, PRESENT_OCCUPANCY_STATUSES);
}

/** Sum In-zone Occupancy from status-grouped view rows. */
export function sumInZoneFromStatusRows(rows: unknown): number {
	return sumCountsForStatuses(rows, IN_ZONE_OCCUPANCY_STATUSES);
}

/** Additive Forecast / Present / In-zone triple for public occupancy surfaces. */
export function occupancyTripleFromStatusRows(rows: unknown): OccupancyTriple {
	return {
		occupancy: sumOccupancyFromStatusRows(rows),
		present: sumPresentFromStatusRows(rows),
		in_zone: sumInZoneFromStatusRows(rows)
	};
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
