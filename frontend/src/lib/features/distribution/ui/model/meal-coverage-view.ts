import {
	presenceOnDay,
	zoneOnDay,
	type PresenceMovement,
	type ZoneMovement
} from '$lib/features/shared';
import {
	COVERAGE_MEALS,
	MIN_MEALS_PER_DAY,
	countingLogsByRecipient,
	type HandoverTally,
	type OtherRecipientGroup,
	type OtherRecipientsOfMeal,
	type CoverageLog,
	type CoverageResident,
	type MealCoverageRow
} from '../../domain/food-supplies/meal-coverage';
import { isCalendarDay, thailandCalendarDay, type MealPeriod } from '../../domain/food-supplies';
import { formatThaiDate } from '$lib/utils/date';
import { historyRecipientNames } from './distribution-history';
import { getMealPeriodLabel } from './ticket-status';

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
	/** Zone at the end of the last day of the range (see `zoneOnDay`). */
	zone: string | null;
	householdId: string | null;
}

/** The days the report covers, or `invalid` for a range that is empty, reversed or in the future. */
export type CoverageRangeMode =
	| { kind: 'invalid' }
	| {
			kind: 'valid';
			from: string;
			to: string;
			/** Every Thai calendar day of the range, oldest first. */
			days: string[];
			single: boolean;
			/** Today is the only day still running: its meals count only once served. */
			includesToday: boolean;
	  };

/** `YYYY-MM-DD` shifted by whole days (calendar arithmetic, no time zone involved). */
function shiftDay(day: string, delta: number): string {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + delta);
	return d.toISOString().slice(0, 10);
}

export function coverageRangeMode(from: string, to: string, today: string): CoverageRangeMode {
	if (!isCalendarDay(from) || !isCalendarDay(to) || from > to || to > today) {
		return { kind: 'invalid' };
	}
	const days: string[] = [];
	for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
	return { kind: 'valid', from, to, days, single: from === to, includesToday: to === today };
}

/** Range choices on the meal coverage report: today (the default) up to a custom range. */
export const COVERAGE_RANGE_PRESETS = ['today', 'yesterday', '7d', '14d', '30d', 'custom'] as const;
export type CoverageRangePreset = (typeof COVERAGE_RANGE_PRESETS)[number];

const PRESET_DAYS: Record<'7d' | '14d' | '30d', number> = { '7d': 7, '14d': 14, '30d': 30 };

/** The days of a preset; `N วัน` covers N days including today. `null` for a custom range not picked yet. */
export function coverageRangeFor(
	preset: CoverageRangePreset,
	today: string,
	custom?: { from: string; to: string }
): { from: string; to: string } | null {
	if (preset === 'today') return { from: today, to: today };
	if (preset === 'yesterday') {
		const yesterday = shiftDay(today, -1);
		return { from: yesterday, to: yesterday };
	}
	if (preset === 'custom') return custom ? { from: custom.from, to: custom.to } : null;
	return { from: shiftDay(today, -(PRESET_DAYS[preset] - 1)), to: today };
}

/**
 * Why a report has nothing to show, so empty cards are not a mystery: nobody in the shelter all
 * day, no distribution logs at all.
 */
export function coverageEmptyReasons(input: {
	single: boolean;
	includesToday: boolean;
	/** People judged on at least one day (in the shelter all day). */
	judgedPeople: number;
	logCount: number;
}): string[] {
	const reasons: string[] = [];
	if (input.judgedPeople === 0) {
		reasons.push(
			!input.single
				? 'ไม่มีผู้ที่อยู่ในศูนย์ตลอดทั้งวันในช่วงนี้'
				: input.includesToday
					? 'ไม่มีผู้ที่อยู่ในศูนย์ตั้งแต่ 00:00 ถึงตอนนี้'
					: 'ไม่มีผู้ที่อยู่ในศูนย์ตลอดทั้งวันนี้'
		);
	}
	if (input.logCount === 0) reasons.push('ไม่มีการแจกจ่ายในช่วงนี้');
	return reasons;
}

/** The range as Thai text under the title: "24 พ.ย. 2569", "18–24 พ.ย. 2569", "28 ต.ค. – 24 พ.ย. 2569". */
export function coverageRangeLabel(from: string, to: string): string {
	const year = (day: string) => Number(day.slice(0, 4)) + 543;
	if (from === to) return `${formatThaiDate(from)} ${year(from)}`;
	if (from.slice(0, 7) === to.slice(0, 7)) {
		return `${Number(from.slice(8))}–${formatThaiDate(to)} ${year(to)}`;
	}
	if (year(from) === year(to)) return `${formatThaiDate(from)} – ${formatThaiDate(to)} ${year(to)}`;
	return `${formatThaiDate(from)} ${year(from)} – ${formatThaiDate(to)} ${year(to)}`;
}

export function thaiToday(now: Date = new Date()): string {
	return thailandCalendarDay(now);
}

/**
 * `incomplete` is every judged row below the threshold: `partial` and `none` together. `part_day`
 * is anyone who was in the shelter only part of a day in the range.
 */
export type CoverageFilter = 'all' | 'complete' | 'incomplete' | 'partial' | 'none' | 'part_day';

export interface CoverageListRow extends MealCoverageRow {
	zone: string | null;
}

export interface CoverageViewRow extends CoverageListRow {
	/** Missing meals another member of the same household has a counting log for. */
	householdRecorded: MealPeriod[];
}

/**
 * Every evacuee as a coverage resident for Thai calendar `days`, presence per day derived from
 * movements. The zone is the one at the end of the last day.
 */
export function coverageResidents(input: {
	days: readonly string[];
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
	const lastDay = input.days[input.days.length - 1];
	return input.evacuees.map((e) => {
		const movements = movementsByEvacuee.get(e._id) ?? [];
		return {
			id: e._id,
			name: names.get(e._id) ?? e._id,
			zone: lastDay
				? zoneOnDay({ day: lastDay, movements, currentZone: e.current_stay?.zone })
				: null,
			householdId: e.household_id ?? null,
			presence: Object.fromEntries(
				input.days.map((day) => [
					day,
					presenceOnDay({ day, movements, current_stay: e.current_stay })
				])
			)
		};
	});
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

/** A row is judged when it was in the shelter all day on a day with a served meal. */
function isJudged(r: MealCoverageRow): boolean {
	return r.judgedDays > 0;
}

/**
 * `all` is everyone judged (the base of every share), `incomplete` is `all - complete`;
 * `part_day` counts people who were there only part of a day, judged or not.
 */
export function coverageCounts(rows: readonly MealCoverageRow[]): Record<CoverageFilter, number> {
	const judged = rows.filter(isJudged);
	return {
		all: judged.length,
		complete: judged.filter((r) => r.complete).length,
		incomplete: judged.filter((r) => !r.complete).length,
		partial: rows.filter(isPartial).length,
		none: rows.filter(isNone).length,
		part_day: rows.filter((r) => r.partialDays > 0).length
	};
}

function isNone(r: MealCoverageRow): boolean {
	return isJudged(r) && !r.complete && r.counted === 0;
}

function isPartial(r: MealCoverageRow): boolean {
	return isJudged(r) && !r.complete && r.counted > 0;
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
		if (filter === 'incomplete' && (!isJudged(r) || r.complete)) return false;
		if (filter === 'partial' && !isPartial(r)) return false;
		if (filter === 'none' && !isNone(r)) return false;
		if (filter === 'part_day' && r.partialDays === 0) return false;
		if (zone !== ALL_ZONES && r.zone !== zone) return false;
		return !needle || r.name.toLowerCase().includes(needle);
	});
}

function sortGroup(r: MealCoverageRow): number {
	if (!isJudged(r)) return 3;
	return r.complete ? 2 : r.counted === 0 ? 0 : 1;
}

/**
 * Nobody-has-a-record first, then partial, then complete, then people there only part of the day;
 * by name inside each group.
 */
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
	for (const r of rows.filter(isJudged)) {
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

export interface OtherRecipientTotal {
	group: OtherRecipientGroup;
	/** Portions over every meal (sum of `qty`). */
	portions: number;
	/** Distribution log records over every meal. */
	records: number;
	byMeal: Record<(typeof COVERAGE_MEALS)[number], HandoverTally>;
}

const OTHER_RECIPIENT_GROUPS: readonly OtherRecipientGroup[] = ['outside', 'volunteer', 'staff'];

/** One total per group (outside, volunteer, staff), always all three, zeros included. */
export function otherRecipientTotals(
	meals: readonly OtherRecipientsOfMeal[]
): OtherRecipientTotal[] {
	return OTHER_RECIPIENT_GROUPS.map((group) => {
		const byMeal = {
			breakfast: { records: 0, portions: 0 },
			lunch: { records: 0, portions: 0 },
			dinner: { records: 0, portions: 0 }
		};
		let portions = 0;
		let records = 0;
		for (const m of meals) {
			byMeal[m.meal] = { ...m[group] };
			portions += m[group].portions;
			records += m[group].records;
		}
		return { group, portions, records, byMeal };
	});
}

/**
 * The note for a range that includes today: how many of the three main meals are served so far
 * and what that means for reaching 2. `null` once all three are served. Meal names in coverage
 * order; "next" is the first unserved meal.
 */
export function coverageTodayNote(servedToday: readonly MealPeriod[]): string | null {
	const served = COVERAGE_MEALS.filter((m) => servedToday.includes(m));
	const unserved = COVERAGE_MEALS.filter((m) => !servedToday.includes(m));
	if (unserved.length === 0) return null;
	const names = served.map(getMealPeriodLabel).join(', ');
	if (served.length === 0) {
		return 'วันนี้ยังไม่ได้แจกมื้อใด · ตัวเลขของวันนี้จะเริ่มนับเมื่อแจกมื้อเช้า';
	}
	if (served.length === 1) {
		return `วันนี้แจกแล้ว 1 จาก 3 มื้อ (${names}) · ยังไม่มีใครรับครบ ${MIN_MEALS_PER_DAY} มื้อได้จนกว่าจะแจกมื้อ${getMealPeriodLabel(unserved[0])}`;
	}
	return `วันนี้แจกแล้ว ${served.length} จาก 3 มื้อ (${names}) · ผู้ที่ยังรับไม่ครบเกณฑ์ยังรับได้ในมื้อ${getMealPeriodLabel(unserved[0])}`;
}
