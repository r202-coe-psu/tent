import { describe, expect, it } from 'vitest';
import {
	attachHouseholdRecorded,
	attachZones,
	coverageDayMode,
	coverageCounts,
	coverageResidents,
	coverageZones,
	filterCoverageRows,
	pageSlice,
	previousThaiDay,
	sortCoverageRows,
	thaiToday,
	type CoverageListRow
} from './meal-coverage-view';

const person = (id: string, status: string, since: string) => ({
	_id: id,
	first_name: id,
	last_name: 'X',
	nickname: null,
	current_stay: { status, since }
});

describe('coverageResidents', () => {
	it('marks presentAllDay from each evacuee own movements', () => {
		const rows = coverageResidents({
			day: '2026-11-09',
			evacuees: [
				person('evacuee:A', 'active', '2026-11-01T00:00:00Z'),
				person('evacuee:B', 'active', '2026-11-01T00:00:00Z')
			],
			movements: [
				{ evacuee_id: 'evacuee:A', action: 'check_in', occurred_at: '2026-11-01T00:00:00Z' },
				{ evacuee_id: 'evacuee:B', action: 'check_in', occurred_at: '2026-11-01T00:00:00Z' },
				{ evacuee_id: 'evacuee:B', action: 'check_out', occurred_at: '2026-11-09T05:00:00Z' }
			]
		});
		expect(rows.map((r) => [r.id, r.presentAllDay])).toEqual([
			['evacuee:A', true],
			['evacuee:B', false]
		]);
	});

	it('falls back to current_stay when an evacuee has no movements', () => {
		const [row] = coverageResidents({
			day: '2026-11-09',
			evacuees: [person('evacuee:A', 'active', '2026-11-01T00:00:00Z')],
			movements: []
		});
		expect(row.presentAllDay).toBe(true);
	});

	it('names with nickname like the history list', () => {
		const [row] = coverageResidents({
			day: '2026-11-09',
			evacuees: [
				{
					...person('evacuee:A', 'active', '2026-11-01T00:00:00Z'),
					first_name: 'สมชาย',
					last_name: 'ใจดี',
					nickname: 'ชาย'
				}
			],
			movements: []
		});
		expect(row.name).toBe('สมชาย ใจดี (ชาย)');
	});
});

describe('previousThaiDay', () => {
	it('is the Thai calendar day before now', () => {
		// 2026-11-09T18:00Z is already 10 Nov in Thailand
		expect(previousThaiDay(new Date('2026-11-09T18:00:00Z'))).toBe('2026-11-09');
	});
});

const row = (id: string, name: string, received: CoverageListRow['received']): CoverageListRow => ({
	id,
	name,
	received,
	missing: [],
	zone: null
});
const none = row('a', 'ศศิ', []);
const partial = row('b', 'กมล', ['lunch']);
const partial2 = row('c', 'Anna', ['dinner']);

describe('coverageResidents zone', () => {
	it('carries the current stay zone and attachZones joins it onto coverage rows', () => {
		const residents = coverageResidents({
			day: '2026-11-09',
			evacuees: [
				{
					...person('evacuee:A', 'active', '2026-11-01T00:00:00Z'),
					current_stay: { status: 'active', since: '2026-11-01T00:00:00Z', zone: 'Z1' }
				},
				person('evacuee:B', 'active', '2026-11-01T00:00:00Z')
			],
			movements: []
		});
		const rows = attachZones(
			[
				{ id: 'evacuee:A', name: 'A', received: [], missing: [] },
				{ id: 'evacuee:B', name: 'B', received: [], missing: [] }
			],
			residents
		);
		expect(rows.map((r) => r.zone)).toEqual(['Z1', null]);
	});
});

describe('coverageCounts', () => {
	it('counts all, none and partial', () => {
		expect(coverageCounts([none, partial, partial2])).toEqual({ all: 3, none: 1, partial: 2 });
	});
	it('is zero for no rows', () => {
		expect(coverageCounts([])).toEqual({ all: 0, none: 0, partial: 0 });
	});
});

describe('filterCoverageRows', () => {
	const rows = [none, partial, partial2];
	it('filters by meals recorded', () => {
		expect(filterCoverageRows(rows, { filter: 'none', query: '' })).toEqual([none]);
		expect(filterCoverageRows(rows, { filter: 'partial', query: '' })).toEqual([partial, partial2]);
		expect(filterCoverageRows(rows, { filter: 'all', query: '' })).toEqual(rows);
	});
	it('matches the name case-insensitively and ignores surrounding whitespace', () => {
		expect(filterCoverageRows(rows, { filter: 'all', query: '  anNA ' })).toEqual([partial2]);
	});
	it('treats a blank query as no filter and combines with the filter', () => {
		expect(filterCoverageRows(rows, { filter: 'all', query: '   ' })).toEqual(rows);
		expect(filterCoverageRows(rows, { filter: 'none', query: 'กมล' })).toEqual([]);
	});
});

describe('sortCoverageRows', () => {
	it('puts fewest meals first, then Thai name order, without mutating', () => {
		const input = [partial, none, row('d', 'กก', [])];
		const sorted = sortCoverageRows(input);
		expect(sorted.map((r) => r.id)).toEqual(['d', 'a', 'b']);
		expect(input.map((r) => r.id)).toEqual(['b', 'a', 'd']);
	});
});

describe('pageSlice', () => {
	const items = Array.from({ length: 45 }, (_, i) => i);
	it('slices a page with 1-based display range', () => {
		expect(pageSlice(items, 2, 20)).toEqual({
			items: items.slice(20, 40),
			page: 2,
			totalPages: 3,
			start: 21,
			end: 40
		});
	});
	it('shortens the last page', () => {
		expect(pageSlice(items, 3, 20)).toMatchObject({ start: 41, end: 45 });
	});
	it('clamps a page beyond range or below 1', () => {
		expect(pageSlice(items, 9, 20).page).toBe(3);
		expect(pageSlice(items, 0, 20).page).toBe(1);
	});
	it('reports 0/0 and one page when empty', () => {
		expect(pageSlice([], 1, 20)).toEqual({ items: [], page: 1, totalPages: 1, start: 0, end: 0 });
	});
});

describe('zone filter', () => {
	const row = (id: string, zone: string | null) => ({
		id,
		name: id,
		received: [],
		missing: [],
		zone
	});
	const rows = [row('a', 'Z2'), row('b', 'Z1'), row('c', null), row('d', 'Z2')];

	it('lists each assigned zone once, sorted', () => {
		expect(coverageZones(rows)).toEqual(['Z1', 'Z2']);
		expect(coverageZones([])).toEqual([]);
	});
	it('keeps only rows in the chosen zone', () => {
		const ids = (zone: string) =>
			filterCoverageRows(rows, { filter: 'all', query: '', zone }).map((r) => r.id);
		expect(ids('Z2')).toEqual(['a', 'd']);
		expect(ids('all')).toEqual(['a', 'b', 'c', 'd']);
	});
	it('combines zone with the meal filter and the name query', () => {
		expect(filterCoverageRows(rows, { filter: 'none', query: 'd', zone: 'Z2' })).toEqual([rows[3]]);
		expect(filterCoverageRows(rows, { filter: 'partial', query: '', zone: 'Z2' })).toEqual([]);
	});
});

describe('coverageResidents on the selected day', () => {
	const evacuee = {
		...person('evacuee:A', 'active', '2026-11-01T00:00:00Z'),
		household_id: 'household:1',
		current_stay: { status: 'active', since: '2026-11-01T00:00:00Z', zone: 'NEW' }
	};

	it('uses the zone of the day, not the zone after a later move', () => {
		const [row] = coverageResidents({
			day: '2026-11-09',
			evacuees: [evacuee],
			movements: [
				{
					evacuee_id: 'evacuee:A',
					action: 'check_in',
					zone: 'OLD',
					occurred_at: '2026-11-01T00:00:00Z'
				},
				{
					evacuee_id: 'evacuee:A',
					action: 'zone_change',
					zone: 'NEW',
					occurred_at: '2026-11-10T03:00:00Z'
				}
			]
		});
		expect(row.zone).toBe('OLD');
	});

	it('falls back to the current zone when no movement names one', () => {
		const [row] = coverageResidents({ day: '2026-11-09', evacuees: [evacuee], movements: [] });
		expect(row.zone).toBe('NEW');
	});

	it('carries the household id', () => {
		const [row] = coverageResidents({ day: '2026-11-09', evacuees: [evacuee], movements: [] });
		expect(row.householdId).toBe('household:1');
		const [lone] = coverageResidents({
			day: '2026-11-09',
			evacuees: [person('evacuee:B', 'active', '2026-11-01T00:00:00Z')],
			movements: []
		});
		expect(lone.householdId).toBeNull();
	});
});

describe('coverageDayMode', () => {
	it('tells a finished day, today, and an unusable value apart', () => {
		expect(coverageDayMode('2026-11-09', '2026-11-10')).toEqual({
			kind: 'past',
			day: '2026-11-09'
		});
		expect(coverageDayMode('2026-11-10', '2026-11-10')).toEqual({
			kind: 'today',
			day: '2026-11-10'
		});
		expect(coverageDayMode('2026-11-11', '2026-11-10')).toEqual({ kind: 'invalid' });
		expect(coverageDayMode('', '2026-11-10')).toEqual({ kind: 'invalid' });
		expect(coverageDayMode('2026-02-31', '2026-11-10')).toEqual({ kind: 'invalid' });
		expect(coverageDayMode('10/11/2026', '2026-11-10')).toEqual({ kind: 'invalid' });
	});
});

describe('thaiToday', () => {
	it('is the Thai calendar day of now', () => {
		expect(thaiToday(new Date('2026-11-09T18:00:00Z'))).toBe('2026-11-10');
	});
});

describe('attachHouseholdRecorded', () => {
	const DAY = '2026-11-09';
	const resident = (id: string, householdId: string | null) => ({
		id,
		name: id,
		zone: null,
		presentAllDay: true,
		householdId
	});
	const log = (id: string, meal: string, extra: Record<string, unknown> = {}) => ({
		recipient_type: 'evacuee' as const,
		recipient_id: id,
		meal,
		status: 'fulfilled',
		is_returnable: false,
		distributed_at: '2026-11-09T01:00:00Z',
		...extra
	});
	const listed = (id: string, received: string[], missing: string[]) => ({
		id,
		name: id,
		received,
		missing,
		zone: null
	});
	const attach = (rows: unknown[], residents: unknown[], logs: unknown[]) =>
		attachHouseholdRecorded(rows as never, residents as never, logs as never, DAY);

	it('lists the missing meals another household member has a log for', () => {
		const out = attach(
			[listed('A', [], ['breakfast', 'lunch', 'dinner'])],
			[resident('A', 'h1'), resident('B', 'h1')],
			[log('B', 'lunch'), log('B', 'dinner')]
		);
		expect(out[0].householdRecorded).toEqual(['lunch', 'dinner']);
	});

	it('does not change the row meals or drop the row', () => {
		const rows = [listed('A', [], ['breakfast'])];
		const out = attach(rows, [resident('A', 'h1'), resident('B', 'h1')], [log('B', 'breakfast')]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ received: [], missing: ['breakfast'] });
	});

	it('ignores other households, a missing household id and the row own logs', () => {
		const out = attach(
			[listed('A', ['lunch'], ['breakfast']), listed('C', [], ['breakfast'])],
			[resident('A', 'h1'), resident('B', 'h2'), resident('C', null), resident('D', null)],
			[log('A', 'lunch'), log('B', 'breakfast'), log('D', 'breakfast')]
		);
		expect(out.map((r) => r.householdRecorded)).toEqual([[], []]);
	});

	it('applies the counting rule: voided, other day and snack logs do not count', () => {
		const out = attach(
			[listed('A', [], ['breakfast', 'lunch', 'dinner'])],
			[resident('A', 'h1'), resident('B', 'h1')],
			[
				log('B', 'breakfast', { status: 'voided' }),
				log('B', 'lunch', { distributed_at: '2026-11-10T01:00:00Z' }),
				log('B', 'snack')
			]
		);
		expect(out[0].householdRecorded).toEqual([]);
	});

	it('counts a household member who was not in the shelter all day', () => {
		const out = attach(
			[listed('A', [], ['breakfast'])],
			[resident('A', 'h1'), { ...resident('B', 'h1'), presentAllDay: false }],
			[log('B', 'breakfast')]
		);
		expect(out[0].householdRecorded).toEqual(['breakfast']);
	});
});
