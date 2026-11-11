import { wasInShelterAllDay, type PresenceMovement } from '$lib/features/shared';
import type { CoverageResident, MealCoverageRow } from '../../domain/food-supplies/meal-coverage';
import { thailandCalendarDay } from '../../domain/food-supplies';
import { historyRecipientNames } from './distribution-history';

interface CoverageEvacuee {
	_id: string;
	first_name: string;
	last_name: string;
	nickname?: string | null;
	current_stay?: { status?: string | null; since?: string | null; zone?: string | null } | null;
}

interface CoverageMovement extends PresenceMovement {
	evacuee_id: string;
}

export interface CoverageViewResident extends CoverageResident {
	zone: string | null;
}

export type CoverageFilter = 'all' | 'none' | 'partial';

export interface CoverageListRow extends MealCoverageRow {
	zone: string | null;
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
		zone: e.current_stay?.zone ?? null,
		presentAllDay: wasInShelterAllDay({
			day: input.day,
			movements: movementsByEvacuee.get(e._id) ?? [],
			current_stay: e.current_stay
		})
	}));
}

/** Yesterday in Thailand — the latest day whose meals are all over. */
export function previousThaiDay(now: Date = new Date()): string {
	return thailandCalendarDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

export function attachZones(
	rows: readonly MealCoverageRow[],
	residents: readonly CoverageViewResident[]
): CoverageListRow[] {
	const zoneById = new Map(residents.map((r) => [r.id, r.zone]));
	return rows.map((r) => ({ ...r, zone: zoneById.get(r.id) ?? null }));
}

export function coverageCounts(rows: readonly MealCoverageRow[]): Record<CoverageFilter, number> {
	const none = rows.filter((r) => r.received.length === 0).length;
	const partial = rows.filter((r) => r.received.length === 1).length;
	return { all: rows.length, none, partial };
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
		if (filter === 'none' && r.received.length !== 0) return false;
		if (filter === 'partial' && r.received.length !== 1) return false;
		if (zone !== ALL_ZONES && r.zone !== zone) return false;
		return !needle || r.name.toLowerCase().includes(needle);
	});
}

export function sortCoverageRows<T extends MealCoverageRow>(rows: readonly T[]): T[] {
	return [...rows].sort(
		(a, b) => a.received.length - b.received.length || a.name.localeCompare(b.name, 'th')
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
