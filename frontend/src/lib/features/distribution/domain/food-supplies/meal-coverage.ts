import { servedMealOfLog, type DistributionLog } from './distribution-log';
import { addQty } from '$lib/utils/qty';
import { thailandCalendarDay, type MealPeriod } from './shared';

/** The main meals that count toward coverage; `snack` is not a meal (#1300). */
export const COVERAGE_MEALS = ['breakfast', 'lunch', 'dinner'] as const satisfies MealPeriod[];

/** A person is flagged when they have a record for fewer than this many main meals in a day. */
export const MIN_MEALS_PER_DAY = 2;

export type CoverageLog = Pick<
	DistributionLog,
	| 'recipient_type'
	| 'recipient_id'
	| 'meal'
	| 'status'
	| 'is_returnable'
	| 'distributed_at'
	| 'distributed_by'
	| 'qty'
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
	/** Meals on record that are already served; unserved meals never count toward `complete`. */
	counted: number;
	/** Has at least `coverageThreshold(servedMeals)` served meals on record. */
	complete: boolean;
	/** Distinct `distributed_by` usernames of the counting logs, in first-seen order. */
	distributedBy: string[];
}

export interface RecipientDay {
	meals: Set<MealPeriod>;
	distributedBy: string[];
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
 * What each evacuee has on record for Thai calendar `day`, by `recipient_id` (the person who
 * eats), so a household member collecting for others does not get credit for them.
 */
export function countingLogsByRecipient(
	logs: readonly CoverageLog[],
	day: string
): Map<string, RecipientDay> {
	const byRecipient = new Map<string, RecipientDay>();
	for (const log of logs) {
		if (log.recipient_type !== 'evacuee' || !log.recipient_id) continue;
		if (thailandCalendarDay(log.distributed_at) !== day) continue;
		const meal = servedMealOfLog(log);
		if (!meal || !(COVERAGE_MEALS as readonly MealPeriod[]).includes(meal)) continue;
		const entry = byRecipient.get(log.recipient_id) ?? { meals: new Set(), distributedBy: [] };
		entry.meals.add(meal);
		if (!entry.distributedBy.includes(log.distributed_by)) {
			entry.distributedBy.push(log.distributed_by);
		}
		byRecipient.set(log.recipient_id, entry);
	}
	return byRecipient;
}

/**
 * One row per resident who was in the shelter all of Thai calendar `day`. `servedMeals` is every
 * coverage meal for a finished day; on a running day it is only the meals already served, so
 * `missing` never lists a meal that is not over yet.
 */
export function mealCoverageRoster(input: {
	day: string;
	residents: readonly CoverageResident[];
	logs: readonly CoverageLog[];
	servedMeals?: readonly MealPeriod[];
}): MealCoverageRow[] {
	const servedMeals = input.servedMeals ?? COVERAGE_MEALS;
	const threshold = coverageThreshold(servedMeals);
	const byRecipient = countingLogsByRecipient(input.logs, input.day);

	return input.residents
		.filter((resident) => resident.presentAllDay)
		.map((resident) => {
			const got = byRecipient.get(resident.id)?.meals ?? new Set<MealPeriod>();
			const received = COVERAGE_MEALS.filter((m) => got.has(m));
			const counted = received.filter((m) => servedMeals.includes(m)).length;
			return {
				id: resident.id,
				name: resident.name,
				received,
				missing: COVERAGE_MEALS.filter((m) => servedMeals.includes(m) && !got.has(m)),
				counted,
				complete: counted >= threshold,
				distributedBy: byRecipient.get(resident.id)?.distributedBy ?? []
			};
		});
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
	for (const { meals } of countingLogsByRecipient(input.logs, input.day).values()) {
		for (const meal of meals) scanned.add(meal);
	}
	return COVERAGE_MEALS.filter((m) => input.servedMeals.includes(m) && !scanned.has(m));
}

export interface MealShare {
	meal: MealPeriod;
	/** False on a running day for a meal that is not over yet. */
	served: boolean;
	/** Residents in the shelter all day who have a counting record for this meal. */
	recorded: number;
}

export interface MealCoverageShares {
	/** Residents in the shelter all day: the denominator of every share. */
	present: number;
	meals: MealShare[];
	/** Residents with at least `coverageThreshold(servedMeals)` served meals on record. */
	complete: number;
}

/** Per main meal, how many of the residents in the shelter all of `day` have a record (#1257). */
export function mealCoverageShares(input: {
	day: string;
	residents: readonly CoverageResident[];
	logs: readonly CoverageLog[];
	servedMeals?: readonly MealPeriod[];
}): MealCoverageShares {
	const servedMeals = input.servedMeals ?? COVERAGE_MEALS;
	const threshold = coverageThreshold(servedMeals);
	const byRecipient = countingLogsByRecipient(input.logs, input.day);
	const received = input.residents
		.filter((r) => r.presentAllDay)
		.map((r) => byRecipient.get(r.id)?.meals ?? new Set<MealPeriod>());
	return {
		present: received.length,
		meals: COVERAGE_MEALS.map((meal) => ({
			meal,
			served: servedMeals.includes(meal),
			recorded: received.filter((got) => got.has(meal)).length
		})),
		complete: received.filter(
			(got) =>
				COVERAGE_MEALS.filter((m) => servedMeals.includes(m) && got.has(m)).length >= threshold
		).length
	};
}

function* portionLogs(logs: readonly CoverageLog[], day: string) {
	for (const log of logs) {
		if (thailandCalendarDay(log.distributed_at) !== day) continue;
		const meal = servedMealOfLog(log);
		if (meal !== 'breakfast' && meal !== 'lunch' && meal !== 'dinner') continue;
		yield { meal, qty: log.qty, by: log.distributed_by };
	}
}

/**
 * Portions handed out per main meal on Thai calendar `day` (#1257). Unlike
 * `countingLogsByRecipient` this counts every recipient type: volunteers and staff eat portions
 * too. Voided logs, loans and snacks are left out like everywhere else (`servedMealOfLog`).
 */
export function distributedPortionsByMeal(
	logs: readonly CoverageLog[],
	day: string
): Record<(typeof COVERAGE_MEALS)[number], number> {
	const totals = { breakfast: '0', lunch: '0', dinner: '0' };
	for (const { meal, qty } of portionLogs(logs, day)) {
		try {
			totals[meal] = addQty(totals[meal], qty);
		} catch {
			// A log with no readable qty adds nothing instead of failing the whole report.
		}
	}
	return {
		breakfast: Number(totals.breakfast),
		lunch: Number(totals.lunch),
		dinner: Number(totals.dinner)
	};
}

export interface DistributorPortions {
	/** `distributed_by` as stored (a username, possibly a phone number). */
	by: string;
	portions: number;
}

/** Who handed out the day's main-meal portions, most first (same counting rule as per meal). */
export function portionsByDistributor(
	logs: readonly CoverageLog[],
	day: string
): DistributorPortions[] {
	const totals = new Map<string, string>();
	for (const { qty, by } of portionLogs(logs, day)) {
		try {
			totals.set(by, addQty(totals.get(by) ?? '0', qty));
		} catch {
			// Unreadable qty adds nothing, as in `distributedPortionsByMeal`.
		}
	}
	return [...totals]
		.map(([by, portions]) => ({ by, portions: Number(portions) }))
		.sort((a, b) => b.portions - a.portions || a.by.localeCompare(b.by));
}
