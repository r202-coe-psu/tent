import {
	wasInShelterAllDay,
	zoneOnDay,
	type PresenceMovement,
	type ZoneMovement
} from '$lib/features/shared';
import {
	countingLogsByRecipient,
	type CoverageLog,
	type CoverageResident,
	type MealCoverageRow
} from '../../domain/food-supplies/meal-coverage';
import { isCalendarDay, thailandCalendarDay, type MealPeriod } from '../../domain/food-supplies';
import { historyRecipientNames } from './distribution-history';

interface CoverageEvacuee {
	_id: string;
	first_name: string;
	last_name: string;
	nickname?: string | null;
	household_id?: string | null;
	current_stay?: { status?: string | null; since?: string | null; zone?: string | null } | null;
}

interface CoverageMovement extends PresenceMovement, ZoneMovement {
	evacuee_id: string;
}

export interface CoverageViewResident extends CoverageResident {
	/** Zone at the end of the selected day (see `zoneOnDay`). */
	zone: string | null;
	householdId: string | null;
}

/** Which kind of day the report is looking at; today is the only one still running. */
export type CoverageDayMode =
	{ kind: 'invalid' } | { kind: 'past'; day: string } | { kind: 'today'; day: string };

export function coverageDayMode(day: string, today: string): CoverageDayMode {
	if (!isCalendarDay(day) || day > today) return { kind: 'invalid' };
	return { kind: day === today ? 'today' : 'past', day };
}

export function thaiToday(now: Date = new Date()): string {
	return thailandCalendarDay(now);
}

/** `incomplete` is every row below the threshold: `partial` and `none` together. */
export type CoverageFilter = 'all' | 'complete' | 'incomplete' | 'partial' | 'none';

export interface CoverageListRow extends MealCoverageRow {
	zone: string | null;
}

export interface CoverageViewRow extends CoverageListRow {
	/** Missing meals another member of the same household has a counting log for. */
	householdRecorded: MealPeriod[];
}

/** Every evacuee as a coverage resident for Thai calendar `day`, presence derived from movements. */
export function coverageResidents(input: {
	day: string;
	evacuees: readonly CoverageEvacuee[];
	movements: readonly CoverageMovement[];
}): CoverageViewResident[] {
	const movementsByEvacuee = new Map<string, CoverageMovement[]>();
	for (const m of input.movements) {
		const list = movementsByEvacuee.get(m.evacuee_id) ?? [];
		list.push(m);
		movementsByEvacuee.set(m.evacuee_id, list);
	}
	const names = historyRecipientNames(input.evacuees);
	return input.evacuees.map((e) => ({
		id: e._id,
		name: names.get(e._id) ?? e._id,
		zone: zoneOnDay({
			day: input.day,
			movements: movementsByEvacuee.get(e._id) ?? [],
			currentZone: e.current_stay?.zone
		}),
		householdId: e.household_id ?? null,
		presentAllDay: wasInShelterAllDay({
			day: input.day,
			movements: movementsByEvacuee.get(e._id) ?? [],
			current_stay: e.current_stay
		})
	}));
}

export function attachZones(
	rows: readonly MealCoverageRow[],
	residents: readonly CoverageViewResident[]
): CoverageListRow[] {
	const zoneById = new Map(residents.map((r) => [r.id, r.zone]));
	return rows.map((r) => ({ ...r, zone: zoneById.get(r.id) ?? null }));
}

/**
 * A hint, not a credit: it never changes `received`/`missing`, so a household member's log is not
 * counted for someone else (CR-240 is not implemented), it only tells the reader where to look.
 */
export function attachHouseholdRecorded<T extends CoverageListRow>(
	rows: readonly T[],
	residents: readonly CoverageViewResident[],
	logs: readonly CoverageLog[],
	day: string
): (T & CoverageViewRow)[] {
	const mealsBy = countingLogsByRecipient(logs, day);
	const membersByHousehold = new Map<string, string[]>();
	for (const r of residents) {
		if (!r.householdId) continue;
		membersByHousehold.set(r.householdId, [...(membersByHousehold.get(r.householdId) ?? []), r.id]);
	}
	const householdOf = new Map(residents.map((r) => [r.id, r.householdId]));
	return rows.map((row) => {
		const householdId = householdOf.get(row.id);
		const others = householdId
			? (membersByHousehold.get(householdId) ?? []).filter((id) => id !== row.id)
			: [];
		const recorded = new Set(others.flatMap((id) => [...(mealsBy.get(id)?.meals ?? [])]));
		return { ...row, householdRecorded: row.missing.filter((m) => recorded.has(m)) };
	});
}

/** `all` is everyone present; the incomplete rows are `all - complete`. */
export function coverageCounts(rows: readonly MealCoverageRow[]): Record<CoverageFilter, number> {
	return {
		all: rows.length,
		complete: rows.filter((r) => r.complete).length,
		incomplete: rows.filter((r) => !r.complete).length,
		partial: rows.filter(isPartial).length,
		none: rows.filter(isNone).length
	};
}

function isNone(r: MealCoverageRow): boolean {
	return !r.complete && r.counted === 0;
}

function isPartial(r: MealCoverageRow): boolean {
	return !r.complete && r.counted > 0;
}

/** `ALL_ZONES`, or a `current_stay.zone` code to keep only that zone. */
export const ALL_ZONES = 'all';

export function coverageZones(rows: readonly { zone: string | null }[]): string[] {
	return [...new Set(rows.flatMap((r) => (r.zone ? [r.zone] : [])))].sort((a, b) =>
		a.localeCompare(b, 'th', { numeric: true })
	);
}

export function filterCoverageRows<T extends MealCoverageRow & { zone?: string | null }>(
	rows: readonly T[],
	{ filter, query, zone = ALL_ZONES }: { filter: CoverageFilter; query: string; zone?: string }
): T[] {
	const needle = query.trim().toLowerCase();
	return rows.filter((r) => {
		if (filter === 'complete' && !r.complete) return false;
		if (filter === 'incomplete' && r.complete) return false;
		if (filter === 'partial' && !isPartial(r)) return false;
		if (filter === 'none' && !isNone(r)) return false;
		if (zone !== ALL_ZONES && r.zone !== zone) return false;
		return !needle || r.name.toLowerCase().includes(needle);
	});
}

function sortGroup(r: MealCoverageRow): number {
	return r.complete ? 2 : r.counted === 0 ? 0 : 1;
}

/** Nobody-has-a-record first, then partial, then complete; by name inside each group. */
export function sortCoverageRows<T extends MealCoverageRow>(rows: readonly T[]): T[] {
	return [...rows].sort(
		(a, b) => sortGroup(a) - sortGroup(b) || a.name.localeCompare(b.name, 'th')
	);
}

export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number) {
	const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
	const current = Math.min(Math.max(1, page), totalPages);
	const from = (current - 1) * pageSize;
	const items = rows.slice(from, from + pageSize);
	return {
		items,
		page: current,
		totalPages,
		start: items.length ? from + 1 : 0,
		end: items.length ? from + items.length : 0
	};
}

export interface ZoneCoverage {
	/** Zone code, or `null` for residents with no zone. */
	zone: string | null;
	total: number;
	complete: number;
	percent: number;
}

/** Complete / present per zone, the least covered zone first so staff know where to go. */
export function coverageByZone(rows: readonly (MealCoverageRow & { zone: string | null })[]) {
	const byZone = new Map<string | null, { total: number; complete: number }>();
	for (const r of rows) {
		const entry = byZone.get(r.zone) ?? { total: 0, complete: 0 };
		entry.total += 1;
		if (r.complete) entry.complete += 1;
		byZone.set(r.zone, entry);
	}
	return [...byZone]
		.map(([zone, e]): ZoneCoverage => ({
			zone,
			...e,
			percent: Math.round((e.complete / e.total) * 100)
		}))
		.sort(
			(a, b) =>
				a.percent - b.percent || (a.zone ?? '').localeCompare(b.zone ?? '', 'th', { numeric: true })
		);
}

export type CoverageLevel = 'good' | 'fair' | 'poor';

/** Share of people covered: 80% and up is good, 50% and up fair, below that poor. */
export function coverageLevel(percent: number): CoverageLevel {
	return percent >= 80 ? 'good' : percent >= 50 ? 'fair' : 'poor';
}
