import { servedMealOfLog, type DistributionLog } from './distribution-log';
import { thailandCalendarDay, type MealPeriod } from './shared';

/** The main meals that count toward coverage; `snack` is not a meal (#1300). */
export const COVERAGE_MEALS = ['breakfast', 'lunch', 'dinner'] as const satisfies MealPeriod[];

/** A person is flagged when they have a record for fewer than this many main meals in a day. */
export const MIN_MEALS_PER_DAY = 2;

export type CoverageLog = Pick<
	DistributionLog,
	'recipient_type' | 'recipient_id' | 'meal' | 'status' | 'is_returnable' | 'distributed_at'
>;

export interface CoverageResident {
	id: string;
	name: string;
	/** In the shelter for the whole day (see `wasInShelterAllDay`). */
	presentAllDay: boolean;
}

export interface MealCoverageRow {
	id: string;
	name: string;
	received: MealPeriod[];
	missing: MealPeriod[];
}

/**
 * Residents who were in the shelter all of Thai calendar `day` yet have a distribution record for
 * fewer than `MIN_MEALS_PER_DAY` main meals. Counts by `recipient_id` (the person who eats), so a
 * household member collecting for others does not get credit for them.
 */
export function summarizeMealCoverage(input: {
	day: string;
	residents: readonly CoverageResident[];
	logs: readonly CoverageLog[];
}): MealCoverageRow[] {
	const receivedBy = new Map<string, Set<MealPeriod>>();
	for (const log of input.logs) {
		if (log.recipient_type !== 'evacuee' || !log.recipient_id) continue;
		if (thailandCalendarDay(log.distributed_at) !== input.day) continue;
		const meal = servedMealOfLog(log);
		if (!meal || !(COVERAGE_MEALS as readonly MealPeriod[]).includes(meal)) continue;
		const meals = receivedBy.get(log.recipient_id) ?? new Set<MealPeriod>();
		meals.add(meal);
		receivedBy.set(log.recipient_id, meals);
	}

	const rows: MealCoverageRow[] = [];
	for (const resident of input.residents) {
		if (!resident.presentAllDay) continue;
		const got = receivedBy.get(resident.id) ?? new Set<MealPeriod>();
		if (got.size >= MIN_MEALS_PER_DAY) continue;
		rows.push({
			id: resident.id,
			name: resident.name,
			received: COVERAGE_MEALS.filter((m) => got.has(m)),
			missing: COVERAGE_MEALS.filter((m) => !got.has(m))
		});
	}
	return rows;
}
