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

/** Whether a "one meal so far" group exists: it only does when a person needs two or more meals. */
export function hasPartialStatus(threshold: number): boolean {
	return threshold >= MIN_MEALS_PER_DAY;
}

/** How many main meals a person needs on record, given the meals that were actually served. */
export function coverageThreshold(servedMeals: readonly MealPeriod[]): number {
	return Math.min(MIN_MEALS_PER_DAY, servedMeals.length);
}

/**
 * Main meals each evacuee has on record for Thai calendar `day`, by `recipient_id` (the person who
 * eats), so a household member collecting for others does not get credit for them.
 */
export function countingMealsByRecipient(
	logs: readonly CoverageLog[],
	day: string
): Map<string, Set<MealPeriod>> {
	const receivedBy = new Map<string, Set<MealPeriod>>();
	for (const log of logs) {
		if (log.recipient_type !== 'evacuee' || !log.recipient_id) continue;
		if (thailandCalendarDay(log.distributed_at) !== day) continue;
		const meal = servedMealOfLog(log);
		if (!meal || !(COVERAGE_MEALS as readonly MealPeriod[]).includes(meal)) continue;
		const meals = receivedBy.get(log.recipient_id) ?? new Set<MealPeriod>();
		meals.add(meal);
		receivedBy.set(log.recipient_id, meals);
	}
	return receivedBy;
}

/**
 * Residents who were in the shelter all of Thai calendar `day` yet have a record for fewer than
 * `coverageThreshold(servedMeals)` main meals. `servedMeals` is every coverage meal for a finished
 * day; on a running day it is only the meals already served, so `missing` never lists a meal that
 * is not over yet.
 */
export function summarizeMealCoverage(input: {
	day: string;
	residents: readonly CoverageResident[];
	logs: readonly CoverageLog[];
	servedMeals?: readonly MealPeriod[];
}): MealCoverageRow[] {
	const servedMeals = input.servedMeals ?? COVERAGE_MEALS;
	const threshold = coverageThreshold(servedMeals);
	const receivedBy = countingMealsByRecipient(input.logs, input.day);

	const rows: MealCoverageRow[] = [];
	for (const resident of input.residents) {
		if (!resident.presentAllDay) continue;
		const got = receivedBy.get(resident.id) ?? new Set<MealPeriod>();
		if (got.size >= threshold) continue;
		rows.push({
			id: resident.id,
			name: resident.name,
			received: COVERAGE_MEALS.filter((m) => got.has(m)),
			missing: COVERAGE_MEALS.filter((m) => servedMeals.includes(m) && !got.has(m))
		});
	}
	return rows;
}

/**
 * Served meals nobody in the shelter has a counting log for on `day`: that meal was probably
 * handed out without scanning, so everyone looks like they missed it.
 */
export function unscannedMeals(input: {
	day: string;
	logs: readonly CoverageLog[];
	servedMeals: readonly MealPeriod[];
}): MealPeriod[] {
	const scanned = new Set<MealPeriod>();
	for (const meals of countingMealsByRecipient(input.logs, input.day).values()) {
		for (const meal of meals) scanned.add(meal);
	}
	return COVERAGE_MEALS.filter((m) => input.servedMeals.includes(m) && !scanned.has(m));
}
