import { servedMealOfLog, type DistributionLog } from './distribution-log';
import { addQty } from '$lib/utils/qty';
import { thailandCalendarDay, type MealPeriod } from './shared';

/** The main meals that count toward coverage; `snack` is not a meal (#1300). */
export const COVERAGE_MEALS = ['breakfast', 'lunch', 'dinner'] as const satisfies MealPeriod[];

/** A person is flagged when they have a record for fewer than this many main meals in a day, today included. */
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

/** How much of a Thai calendar day a resident was in the shelter. */
export type DayPresence = 'all' | 'partial' | 'none';

/** One day of the report and the main meals that count on it. */
export interface CoverageDay {
	/** Thai calendar day, `YYYY-MM-DD`. */
	day: string;
	/**
	 * Every coverage meal for a finished day; on a running day only the meals already served, so
	 * `missing` never lists a meal that is not over yet.
	 */
	servedMeals: readonly MealPeriod[];
}

export interface CoverageResident {
	id: string;
	name: string;
	/** Presence per Thai calendar day; a day not listed counts as `none`. */
	presence: Readonly<Record<string, DayPresence>>;
}

export interface MealCoverageRow {
	id: string;
	name: string;
	/** Main meals on record on the days they were in the shelter, in coverage order. */
	received: MealPeriod[];
	/** Served meals with no record; only for a one-day report, else empty. */
	missing: MealPeriod[];
	/** Served meals on record over the judged days (see `judgedDays`). */
	counted: number;
	/** Judged on at least one day and short on none of them. */
	complete: boolean;
	/** Distinct `distributed_by` usernames of the counting logs, in first-seen order. */
	distributedBy: string[];
	/** Days in the shelter all day: the days they are judged, against `MIN_MEALS_PER_DAY` served meals. */
	judgedDays: number;
	/** Judged days with fewer than `MIN_MEALS_PER_DAY` served meals on record. */
	shortDays: number;
	/** Days in the shelter only part of the day: listed, but never judged. */
	partialDays: number;
	/** Meals on record over every day they were in the shelter, whole or part of it. */
	mealsReceived: number;
}

export interface RecipientDay {
	meals: Set<MealPeriod>;
	distributedBy: string[];
}

function isCoverageMeal(meal: MealPeriod | null): meal is (typeof COVERAGE_MEALS)[number] {
	return !!meal && (COVERAGE_MEALS as readonly MealPeriod[]).includes(meal);
}

/**
 * What each evacuee has on record per Thai calendar day, by `recipient_id` (the person who eats),
 * so a household member collecting for others does not get credit for them.
 */
function countingLogsByDay(logs: readonly CoverageLog[]): Map<string, Map<string, RecipientDay>> {
	const byDay = new Map<string, Map<string, RecipientDay>>();
	for (const log of logs) {
		if (log.recipient_type !== 'evacuee' || !log.recipient_id) continue;
		const meal = servedMealOfLog(log);
		if (!isCoverageMeal(meal)) continue;
		const day = thailandCalendarDay(log.distributed_at);
		const byRecipient = byDay.get(day) ?? new Map<string, RecipientDay>();
		const entry = byRecipient.get(log.recipient_id) ?? { meals: new Set(), distributedBy: [] };
		entry.meals.add(meal);
		if (!entry.distributedBy.includes(log.distributed_by)) {
			entry.distributedBy.push(log.distributed_by);
		}
		byRecipient.set(log.recipient_id, entry);
		byDay.set(day, byRecipient);
	}
	return byDay;
}

/** What each evacuee has on record for Thai calendar `day`. */
export function countingLogsByRecipient(
	logs: readonly CoverageLog[],
	day: string
): Map<string, RecipientDay> {
	return countingLogsByDay(logs).get(day) ?? new Map();
}

const NO_MEALS: ReadonlySet<MealPeriod> = new Set();

/**
 * Over a range, a running day with no meal served yet is not judged: nobody could have two meals.
 * A single selected day is always judged, so its list still shows everyone at 0 meals.
 */
function isJudgedDay(servedMeals: readonly MealPeriod[], single: boolean): boolean {
	return single || servedMeals.length > 0;
}

/**
 * One row per resident who was in the shelter on any day of `days`: judged on the days they were
 * there all day and a meal was served, listed but never judged on the days they were there only
 * part of the day.
 */
export function mealCoverageRoster(input: {
	days: readonly CoverageDay[];
	residents: readonly CoverageResident[];
	logs: readonly CoverageLog[];
}): MealCoverageRow[] {
	const byDay = countingLogsByDay(input.logs);
	const single = input.days.length === 1;
	const rows: MealCoverageRow[] = [];

	for (const resident of input.residents) {
		const received = new Set<MealPeriod>();
		const distributedBy: string[] = [];
		let judgedDays = 0;
		let shortDays = 0;
		let partialDays = 0;
		let counted = 0;
		let mealsReceived = 0;
		let missing: MealPeriod[] = [];
		let listed = false;

		for (const { day, servedMeals } of input.days) {
			const presence = resident.presence[day] ?? 'none';
			if (presence === 'none') continue;
			listed = true;
			const entry = byDay.get(day)?.get(resident.id);
			const got = entry?.meals ?? NO_MEALS;
			for (const meal of got) received.add(meal);
			for (const by of entry?.distributedBy ?? []) {
				if (!distributedBy.includes(by)) distributedBy.push(by);
			}
			mealsReceived += got.size;
			if (single) missing = COVERAGE_MEALS.filter((m) => servedMeals.includes(m) && !got.has(m));

			if (presence === 'partial') {
				partialDays += 1;
				continue;
			}
			if (!isJudgedDay(servedMeals, single)) continue;
			const dayCounted = COVERAGE_MEALS.filter((m) => servedMeals.includes(m) && got.has(m)).length;
			judgedDays += 1;
			counted += dayCounted;
			if (dayCounted < MIN_MEALS_PER_DAY) shortDays += 1;
		}

		if (!listed) continue;
		rows.push({
			id: resident.id,
			name: resident.name,
			received: COVERAGE_MEALS.filter((m) => received.has(m)),
			missing,
			counted,
			complete: judgedDays > 0 && shortDays === 0,
			distributedBy,
			judgedDays,
			shortDays,
			partialDays,
			mealsReceived
		});
	}
	return rows;
}

export interface UnscannedMeal {
	day: string;
	meal: MealPeriod;
}

/**
 * Served meals with no distribution log at all on a day somebody was in the shelter all of it:
 * that meal was probably handed out without recording it, so everyone looks like they missed it.
 * A log of any recipient type counts (evacuee, volunteer, staff, outside), so a meal handed out
 * only to people by name search or anonymously is not flagged.
 */
export function unscannedMeals(input: {
	days: readonly CoverageDay[];
	residents: readonly CoverageResident[];
	logs: readonly CoverageLog[];
}): UnscannedMeal[] {
	const handedOut = new Map<string, Set<MealPeriod>>();
	for (const log of input.logs) {
		const meal = servedMealOfLog(log);
		if (!isCoverageMeal(meal)) continue;
		const day = thailandCalendarDay(log.distributed_at);
		handedOut.set(day, (handedOut.get(day) ?? new Set()).add(meal));
	}
	return input.days.flatMap(({ day, servedMeals }) => {
		if (!input.residents.some((r) => r.presence[day] === 'all')) return [];
		return COVERAGE_MEALS.filter((m) => servedMeals.includes(m) && !handedOut.get(day)?.has(m)).map(
			(meal) => ({ day, meal })
		);
	});
}

export interface MealShare {
	meal: MealPeriod;
	/** False on a running day for a meal that is not over yet (true when served on any day). */
	served: boolean;
	/** Person-days with a counting record for this meal (whole or part of the day). */
	recorded: number;
	/**
	 * Person-days that could have a record for this meal: in the shelter all day while it was served,
	 * plus anyone else (part of the day, meal not served yet) who has a record, so `recorded` never
	 * exceeds it.
	 */
	total: number;
}

export interface MealCoverageShares {
	/** Person-days judged (in the shelter all day, a meal served): the base of `complete`. */
	present: number;
	meals: MealShare[];
	/** Judged person-days with at least `MIN_MEALS_PER_DAY` served meals on record. */
	complete: number;
}

/**
 * Per main meal, how many person-days have a record (#1257). Over one day a person-day is a
 * person; over a range each day a person was in the shelter counts separately.
 */
export function mealCoverageShares(input: {
	days: readonly CoverageDay[];
	residents: readonly CoverageResident[];
	logs: readonly CoverageLog[];
}): MealCoverageShares {
	const byDay = countingLogsByDay(input.logs);
	let present = 0;
	let complete = 0;
	const recorded = { breakfast: 0, lunch: 0, dinner: 0 };
	const total = { breakfast: 0, lunch: 0, dinner: 0 };

	const single = input.days.length === 1;
	for (const { day, servedMeals } of input.days) {
		const judged = isJudgedDay(servedMeals, single);
		for (const resident of input.residents) {
			const presence = resident.presence[day] ?? 'none';
			if (presence === 'none') continue;
			const got = byDay.get(day)?.get(resident.id)?.meals ?? NO_MEALS;
			const allDay = presence === 'all';
			for (const meal of COVERAGE_MEALS) {
				const has = got.has(meal);
				if (has) recorded[meal] += 1;
				if (has || (allDay && servedMeals.includes(meal))) total[meal] += 1;
			}
			if (allDay && judged) {
				present += 1;
				if (
					COVERAGE_MEALS.filter((m) => servedMeals.includes(m) && got.has(m)).length >=
					MIN_MEALS_PER_DAY
				) {
					complete += 1;
				}
			}
		}
	}
	return {
		present,
		meals: COVERAGE_MEALS.map((meal) => ({
			meal,
			served: input.days.some((d) => d.servedMeals.includes(meal)),
			recorded: recorded[meal],
			total: total[meal]
		})),
		complete
	};
}

/** Thai calendar days `from`..`to`, both inclusive (`YYYY-MM-DD`). */
export interface DayRange {
	from: string;
	to: string;
}

/** One Thai calendar day, or a `DayRange` of them. */
export type DaySelector = string | DayRange;

function inSelector(selector: DaySelector, day: string): boolean {
	const { from, to } = typeof selector === 'string' ? { from: selector, to: selector } : selector;
	return day >= from && day <= to;
}

function* portionLogs(logs: readonly CoverageLog[], selector: DaySelector) {
	for (const log of logs) {
		if (!inSelector(selector, thailandCalendarDay(log.distributed_at))) continue;
		const meal = servedMealOfLog(log);
		if (meal !== 'breakfast' && meal !== 'lunch' && meal !== 'dinner') continue;
		yield { meal, qty: log.qty, by: log.distributed_by };
	}
}

/**
 * Portions handed out per main meal on Thai calendar `days` (#1257). Unlike
 * `countingLogsByRecipient` this counts every recipient type: volunteers and staff eat portions
 * too. Voided logs, loans and snacks are left out like everywhere else (`servedMealOfLog`).
 */
export function distributedPortionsByMeal(
	logs: readonly CoverageLog[],
	days: DaySelector
): Record<(typeof COVERAGE_MEALS)[number], number> {
	const totals = { breakfast: '0', lunch: '0', dinner: '0' };
	for (const { meal, qty } of portionLogs(logs, days)) {
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

/** Who handed out the main-meal portions of `days`, most first (same counting rule as per meal). */
export function portionsByDistributor(
	logs: readonly CoverageLog[],
	days: DaySelector
): DistributorPortions[] {
	const totals = new Map<string, string>();
	for (const { qty, by } of portionLogs(logs, days)) {
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

export type OtherRecipientGroup = 'outside' | 'volunteer' | 'staff';

export type OtherRecipientsOfMeal = { meal: (typeof COVERAGE_MEALS)[number] } & Record<
	OtherRecipientGroup,
	number
>;

/**
 * Portions handed to people who are not on the evacuee roster, per main meal: outside (anonymous
 * or named by hand), volunteers and staff. Same counting rule as the portions; evacuees are the
 * table's business.
 */
export function otherRecipientsByMeal(
	logs: readonly CoverageLog[],
	days: DaySelector
): OtherRecipientsOfMeal[] {
	const rows = COVERAGE_MEALS.map((meal): OtherRecipientsOfMeal => ({
		meal,
		outside: 0,
		volunteer: 0,
		staff: 0
	}));
	for (const log of logs) {
		const group = log.recipient_type;
		if (group !== 'outside' && group !== 'volunteer' && group !== 'staff') continue;
		if (!inSelector(days, thailandCalendarDay(log.distributed_at))) continue;
		const meal = servedMealOfLog(log);
		if (!isCoverageMeal(meal)) continue;
		const row = rows[COVERAGE_MEALS.indexOf(meal)];
		try {
			row[group] = Number(addQty(String(row[group]), log.qty));
		} catch {
			// A log with no readable qty adds no portions.
		}
	}
	return rows;
}

export interface DailyMealTrend {
	day: string;
	/** Portions per main meal, every recipient type. */
	portions: Record<(typeof COVERAGE_MEALS)[number], number>;
	/** Distinct evacuees with at least one counting record that day. */
	people: number;
}

/** One entry per day of `days`, in that order, zeros for a day with no logs. */
export function dailyMealTrend(
	logs: readonly CoverageLog[],
	days: readonly string[]
): DailyMealTrend[] {
	const byDay = countingLogsByDay(logs);
	return days.map((day) => ({
		day,
		portions: distributedPortionsByMeal(logs, day),
		people: byDay.get(day)?.size ?? 0
	}));
}
