import { describe, expect, it } from 'vitest';
import {
	attachHouseholdRecorded,
	attachZones,
	COVERAGE_RANGE_PRESETS,
	COVERAGE_STATUS_TONES,
	coverageEmptyReasons,
	coverageFilterLabels,
	coverageStatusLabels,
	donutSegments,
	coverageTodayNote,
	otherRecipientTotals,
	coverageRangeLabel,
	coverageRangeFor,
	coverageRangeMode,
	coverageCounts,
	coverageResidents,
	coverageZones,
	filterCoverageRows,
	pageSlice,
	sortCoverageRows,
	thaiToday,
	type CoverageListRow,
	coverageByZone,
	coverageLevel
} from './meal-coverage-view';

const person = (id: string, status: string, since: string) => ({
	_id: id,
	first_name: id,
	last_name: 'X',
	nickname: null,
	current_stay: { status, since }
});

describe('coverageResidents', () => {
	it('derives each evacuee presence on the day from their own movements', () => {
		const rows = coverageResidents({
			days: ['2026-11-09'],
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
		expect(rows.map((r) => [r.id, r.presence['2026-11-09']])).toEqual([
			['evacuee:A', 'all'],
			['evacuee:B', 'partial']
		]);
	});

	it('falls back to current_stay when an evacuee has no movements', () => {
		const [row] = coverageResidents({
			days: ['2026-11-09'],
			evacuees: [person('evacuee:A', 'active', '2026-11-01T00:00:00Z')],
			movements: []
		});
		expect(row.presence['2026-11-09']).toBe('all');
	});

	it('names with nickname like the history list', () => {
		const [row] = coverageResidents({
			days: ['2026-11-09'],
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

const row = (
	id: string,
	name: string,
	received: CoverageListRow['received'],
	complete = false
): CoverageListRow => ({
	id,
	name,
	received,
	missing: [],
	counted: received.length,
	complete,
	distributedBy: [],
	judgedDays: 1,
	shortDays: complete ? 0 : 1,
	partialDays: 0,
	mealsReceived: received.length,
	zone: null
});
const none = row('a', 'ศศิ', []);
const partial = row('b', 'กมล', ['lunch']);
const partial2 = row('c', 'Anna', ['dinner']);
const complete = row('e', 'บุญ', ['breakfast', 'lunch'], true);

describe('coverageResidents zone', () => {
	it('carries the current stay zone and attachZones joins it onto coverage rows', () => {
		const residents = coverageResidents({
			days: ['2026-11-09'],
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
				{
					id: 'evacuee:A',
					name: 'A',
					received: [],
					missing: [],
					counted: 0,
					complete: false,
					distributedBy: [],
					judgedDays: 1,
					shortDays: 1,
					partialDays: 0,
					mealsReceived: 0
				},
				{
					id: 'evacuee:B',
					name: 'B',
					received: [],
					missing: [],
					counted: 0,
					complete: false,
					distributedBy: [],
					judgedDays: 1,
					shortDays: 1,
					partialDays: 0,
					mealsReceived: 0
				}
			],
			residents
		);
		expect(rows.map((r) => r.zone)).toEqual(['Z1', null]);
	});
});

describe('coverageCounts', () => {
	it('counts all, complete, partial and none', () => {
		expect(coverageCounts([none, partial, partial2, complete])).toEqual({
			all: 4,
			complete: 1,
			incomplete: 3,
			partial: 2,
			none: 1,
			part_day: 0
		});
	});
	it('does not count a complete row with one meal as partial (threshold 1)', () => {
		const one = row('f', 'ก', ['lunch'], true);
		expect(coverageCounts([one])).toEqual({
			all: 1,
			complete: 1,
			incomplete: 0,
			partial: 0,
			none: 0,
			part_day: 0
		});
	});
	it('is zero for no rows', () => {
		expect(coverageCounts([])).toEqual({
			all: 0,
			complete: 0,
			incomplete: 0,
			partial: 0,
			none: 0,
			part_day: 0
		});
	});
});

describe('filterCoverageRows', () => {
	const rows = [none, partial, partial2, complete];
	it('filters by meals recorded', () => {
		expect(filterCoverageRows(rows, { filter: 'none', query: '' })).toEqual([none]);
		expect(filterCoverageRows(rows, { filter: 'partial', query: '' })).toEqual([partial, partial2]);
		expect(filterCoverageRows(rows, { filter: 'complete', query: '' })).toEqual([complete]);
		expect(filterCoverageRows(rows, { filter: 'all', query: '' })).toEqual(rows);
	});
	it('keeps a complete one-meal row out of partial', () => {
		const one = row('f', 'ก', ['lunch'], true);
		expect(filterCoverageRows([one], { filter: 'partial', query: '' })).toEqual([]);
		expect(filterCoverageRows([one], { filter: 'complete', query: '' })).toEqual([one]);
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
	it('orders none, partial, complete, then Thai name order, without mutating', () => {
		const input = [
			complete,
			partial,
			none,
			row('d', 'กก', []),
			row('g', 'กข', ['breakfast', 'lunch'], true)
		];
		const sorted = sortCoverageRows(input);
		expect(sorted.map((r) => r.id)).toEqual(['d', 'a', 'b', 'g', 'e']);
		expect(input.map((r) => r.id)).toEqual(['e', 'b', 'a', 'd', 'g']);
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
		counted: 0,
		complete: false,
		distributedBy: [],
		judgedDays: 1,
		shortDays: 1,
		partialDays: 0,
		mealsReceived: 0,
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
			days: ['2026-11-09'],
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
		const [row] = coverageResidents({ days: ['2026-11-09'], evacuees: [evacuee], movements: [] });
		expect(row.zone).toBe('NEW');
	});

	it('carries the household id', () => {
		const [row] = coverageResidents({ days: ['2026-11-09'], evacuees: [evacuee], movements: [] });
		expect(row.householdId).toBe('household:1');
		const [lone] = coverageResidents({
			days: ['2026-11-09'],
			evacuees: [person('evacuee:B', 'active', '2026-11-01T00:00:00Z')],
			movements: []
		});
		expect(lone.householdId).toBeNull();
	});
});

describe('coverageRangeMode', () => {
	it('lists every day of a usable range and says whether it is one day or includes today', () => {
		expect(coverageRangeMode('2026-11-08', '2026-11-10', '2026-11-10')).toEqual({
			kind: 'valid',
			from: '2026-11-08',
			to: '2026-11-10',
			days: ['2026-11-08', '2026-11-09', '2026-11-10'],
			single: false,
			includesToday: true
		});
		expect(coverageRangeMode('2026-11-09', '2026-11-09', '2026-11-10')).toMatchObject({
			kind: 'valid',
			days: ['2026-11-09'],
			single: true,
			includesToday: false
		});
	});

	it('rejects a day in the future, a reversed range and values that are not days', () => {
		const bad = { kind: 'invalid' };
		expect(coverageRangeMode('2026-11-09', '2026-11-11', '2026-11-10')).toEqual(bad);
		expect(coverageRangeMode('2026-11-10', '2026-11-09', '2026-11-10')).toEqual(bad);
		expect(coverageRangeMode('', '2026-11-10', '2026-11-10')).toEqual(bad);
		expect(coverageRangeMode('2026-02-31', '2026-02-31', '2026-11-10')).toEqual(bad);
		expect(coverageRangeMode('10/11/2026', '2026-11-10', '2026-11-10')).toEqual(bad);
	});

	it('has no limit on the length of a range', () => {
		const mode = coverageRangeMode('2025-01-01', '2026-11-10', '2026-11-10');
		expect(mode.kind === 'valid' && mode.days.length).toBe(679);
	});
});

describe('coverageRangeFor (presets)', () => {
	const today = '2026-11-10';
	it('offers today first, then yesterday, 7, 14, 30 days and a custom range', () => {
		expect(COVERAGE_RANGE_PRESETS).toEqual(['today', 'yesterday', '7d', '14d', '30d', 'custom']);
	});

	it('maps each preset to its days, N days counting today', () => {
		expect(coverageRangeFor('today', today)).toEqual({ from: '2026-11-10', to: '2026-11-10' });
		expect(coverageRangeFor('yesterday', today)).toEqual({ from: '2026-11-09', to: '2026-11-09' });
		expect(coverageRangeFor('7d', today)).toEqual({ from: '2026-11-04', to: '2026-11-10' });
		expect(coverageRangeFor('14d', today)).toEqual({ from: '2026-10-28', to: '2026-11-10' });
		expect(coverageRangeFor('30d', today)).toEqual({ from: '2026-10-12', to: '2026-11-10' });
	});

	it('passes a custom range through, and has none until one is picked', () => {
		expect(coverageRangeFor('custom', today, { from: '2026-11-01', to: '2026-11-03' })).toEqual({
			from: '2026-11-01',
			to: '2026-11-03'
		});
		expect(coverageRangeFor('custom', today)).toBeNull();
	});
});

describe('coverageEmptyReasons', () => {
	const base = {
		single: true,
		includesToday: false,
		judgedPeople: 3,
		logCount: 5
	};

	it('has nothing to say when there is data', () => {
		expect(coverageEmptyReasons(base)).toEqual([]);
	});

	it('explains nobody being in the shelter all day, for one day and for a range', () => {
		expect(coverageEmptyReasons({ ...base, judgedPeople: 0 })).toEqual([
			'ไม่มีผู้ที่อยู่ในศูนย์ตลอดทั้งวันนี้'
		]);
		expect(coverageEmptyReasons({ ...base, includesToday: true, judgedPeople: 0 })).toEqual([
			'ไม่มีผู้ที่อยู่ในศูนย์ตั้งแต่ 00:00 ถึงตอนนี้'
		]);
		expect(coverageEmptyReasons({ ...base, single: false, judgedPeople: 0 })).toEqual([
			'ไม่มีผู้ที่อยู่ในศูนย์ตลอดทั้งวันในช่วงนี้'
		]);
	});

	it('explains a range with no distribution logs', () => {
		expect(coverageEmptyReasons({ ...base, logCount: 0 })).toEqual(['ไม่มีการแจกจ่ายในช่วงนี้']);
	});

	it('lists every reason that applies', () => {
		expect(
			coverageEmptyReasons({ ...base, single: false, judgedPeople: 0, logCount: 0 })
		).toHaveLength(2);
	});
});

describe('coverageResidents over a range', () => {
	const days = ['2026-11-08', '2026-11-09', '2026-11-10'];
	const evacuee = {
		...person('evacuee:A', 'active', '2026-11-01T00:00:00Z'),
		current_stay: { status: 'active', since: '2026-11-01T00:00:00Z', zone: 'NEW' }
	};

	it('gives the presence of every day: all, partial or none', () => {
		const [row] = coverageResidents({
			days,
			evacuees: [evacuee],
			movements: [
				{ evacuee_id: 'evacuee:A', action: 'check_in', occurred_at: '2026-11-09T03:00:00Z' }
			]
		});
		expect(row.presence).toEqual({
			'2026-11-08': 'none',
			'2026-11-09': 'partial',
			'2026-11-10': 'all'
		});
	});

	it('takes the zone at the end of the last day of the range', () => {
		const [row] = coverageResidents({
			days,
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
					zone: 'MID',
					occurred_at: '2026-11-09T03:00:00Z'
				},
				{
					evacuee_id: 'evacuee:A',
					action: 'zone_change',
					zone: 'NEW',
					occurred_at: '2026-11-11T03:00:00Z'
				}
			]
		});
		expect(row.zone).toBe('MID');
	});
});

describe('rows of people who were in the shelter only part of the day', () => {
	const partDay: CoverageListRow = {
		...row('p', 'ปราณี', ['breakfast']),
		counted: 0,
		judgedDays: 0,
		shortDays: 0,
		partialDays: 1
	};

	it('are in everyone but never in the complete, partial or none counts', () => {
		expect(coverageCounts([none, complete, partDay])).toEqual({
			all: 2,
			complete: 1,
			incomplete: 1,
			partial: 0,
			none: 1,
			part_day: 1
		});
	});

	it('can be filtered on their own and stay out of the incomplete filter', () => {
		const rows = [none, complete, partDay];
		expect(filterCoverageRows(rows, { filter: 'part_day', query: '' })).toEqual([partDay]);
		expect(filterCoverageRows(rows, { filter: 'incomplete', query: '' })).toEqual([none]);
		expect(filterCoverageRows(rows, { filter: 'all', query: '' })).toEqual(rows);
	});

	it('sort after the complete rows', () => {
		expect(sortCoverageRows([partDay, complete, none]).map((r) => r.id)).toEqual(['a', 'e', 'p']);
	});

	it('keep a judged row that also has a part day in its own status', () => {
		const mixed = { ...none, id: 'm', partialDays: 2 };
		expect(coverageCounts([mixed]).none).toBe(1);
		expect(coverageCounts([mixed]).part_day).toBe(1);
	});

	it('are left out of the zone coverage', () => {
		expect(coverageByZone([{ ...partDay, zone: 'Z1' }])).toEqual([]);
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
		presence: { [DAY]: 'all' as const },
		householdId
	});
	const log = (id: string, meal: string, extra: Record<string, unknown> = {}) => ({
		recipient_type: 'evacuee' as const,
		recipient_id: id,
		meal,
		status: 'fulfilled',
		is_returnable: false,
		distributed_at: '2026-11-09T01:00:00Z',
		distributed_by: 'staff1',
		...extra
	});
	const listed = (id: string, received: string[], missing: string[]) => ({
		id,
		name: id,
		received,
		missing,
		complete: false,
		distributedBy: [],
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

describe('coverageByZone', () => {
	const r = (zone: string | null, complete: boolean) => ({
		id: Math.random().toString(),
		name: 'n',
		received: [],
		missing: [],
		counted: complete ? 2 : 0,
		complete,
		distributedBy: [],
		judgedDays: 1,
		shortDays: complete ? 0 : 1,
		partialDays: 0,
		mealsReceived: 0,
		zone
	});

	it('counts complete over present per zone and lists the least covered zone first', () => {
		const rows = [r('Z1', true), r('Z1', true), r('Z2', false), r('Z2', true), r(null, false)];
		expect(coverageByZone(rows)).toEqual([
			{ zone: null, total: 1, complete: 0, percent: 0 },
			{ zone: 'Z2', total: 2, complete: 1, percent: 50 },
			{ zone: 'Z1', total: 2, complete: 2, percent: 100 }
		]);
	});

	it('is empty for no rows', () => {
		expect(coverageByZone([])).toEqual([]);
	});
});

describe('coverageLevel', () => {
	it('is good from 80, fair from 50, poor below', () => {
		expect([100, 80, 79, 50, 49, 0].map(coverageLevel)).toEqual([
			'good',
			'good',
			'fair',
			'fair',
			'poor',
			'poor'
		]);
	});
});

describe('coverageRangeLabel', () => {
	it('writes one day with its Buddhist year', () => {
		expect(coverageRangeLabel('2026-11-24', '2026-11-24')).toBe('24 พ.ย. 2569');
	});

	it('shares the month and year inside one month', () => {
		expect(coverageRangeLabel('2026-11-18', '2026-11-24')).toBe('18–24 พ.ย. 2569');
	});

	it('names both months across months of one year, and both years across years', () => {
		expect(coverageRangeLabel('2026-10-28', '2026-11-24')).toBe('28 ต.ค. – 24 พ.ย. 2569');
		expect(coverageRangeLabel('2025-12-30', '2026-01-02')).toBe('30 ธ.ค. 2568 – 2 ม.ค. 2569');
	});
});

describe('otherRecipientTotals', () => {
	const meals = [
		{ meal: 'breakfast' as const, outside: 10, volunteer: 3, staff: 0 },
		{ meal: 'lunch' as const, outside: 6, volunteer: 0, staff: 0 },
		{ meal: 'dinner' as const, outside: 0, volunteer: 0, staff: 0 }
	];

	it('sums each group over the meals, with the portions per meal', () => {
		expect(otherRecipientTotals(meals)).toEqual([
			{ group: 'outside', portions: 16, byMeal: { breakfast: 10, lunch: 6, dinner: 0 } },
			{ group: 'volunteer', portions: 3, byMeal: { breakfast: 3, lunch: 0, dinner: 0 } },
			{ group: 'staff', portions: 0, byMeal: { breakfast: 0, lunch: 0, dinner: 0 } }
		]);
	});

	it('keeps all three groups, zeros included, for no hand-overs', () => {
		expect(otherRecipientTotals([]).map((g) => [g.group, g.portions])).toEqual([
			['outside', 0],
			['volunteer', 0],
			['staff', 0]
		]);
	});
});

describe('coverageTodayNote', () => {
	it('says nothing has been handed out yet when no meal is served', () => {
		expect(coverageTodayNote([])).toBe(
			'วันนี้ยังไม่ได้แจกมื้อใด · ตัวเลขของวันนี้จะเริ่มนับเมื่อแจกมื้อเช้า'
		);
	});

	it('names the one served meal and the next meal that can make 2', () => {
		expect(coverageTodayNote(['breakfast'])).toBe(
			'วันนี้แจกแล้ว 1 จาก 3 มื้อ (เช้า) · ยังไม่มีใครรับครบ 2 มื้อได้จนกว่าจะแจกมื้อกลางวัน'
		);
	});

	it('takes the first unserved meal as next, whatever order meals were served in', () => {
		expect(coverageTodayNote(['lunch'])).toBe(
			'วันนี้แจกแล้ว 1 จาก 3 มื้อ (กลางวัน) · ยังไม่มีใครรับครบ 2 มื้อได้จนกว่าจะแจกมื้อเช้า'
		);
		expect(coverageTodayNote(['dinner'])).toContain('(เย็น)');
	});

	it('says who can still catch up in the remaining meal when two are served', () => {
		expect(coverageTodayNote(['breakfast', 'lunch'])).toBe(
			'วันนี้แจกแล้ว 2 จาก 3 มื้อ (เช้า, กลางวัน) · ผู้ที่ยังรับไม่ถึง 2 มื้อยังรับได้ในมื้อเย็น'
		);
		expect(coverageTodayNote(['dinner', 'breakfast'])).toBe(
			'วันนี้แจกแล้ว 2 จาก 3 มื้อ (เช้า, เย็น) · ผู้ที่ยังรับไม่ถึง 2 มื้อยังรับได้ในมื้อกลางวัน'
		);
	});

	it('has no note once all three meals are served, and ignores a snack', () => {
		expect(coverageTodayNote(['breakfast', 'lunch', 'dinner'])).toBeNull();
		expect(coverageTodayNote(['snack'])).toContain('วันนี้ยังไม่ได้แจกมื้อใด');
	});
});

describe('coverage status tones and labels', () => {
	it('gives each status one colour: green complete, amber one meal, red no record', () => {
		expect(COVERAGE_STATUS_TONES.complete.color).toBe('#10B981');
		expect(COVERAGE_STATUS_TONES.partial.color).toBe('#F59E0B');
		expect(COVERAGE_STATUS_TONES.none.color).toBe('#EF4444');
	});

	it('words the statuses for one day and for a range', () => {
		expect(coverageStatusLabels(false)).toEqual({
			complete: 'รับ 2 มื้อขึ้นไป/วัน',
			incomplete: 'รับไม่ถึง 2 มื้อ/วัน',
			partial: 'รับแค่ 1 มื้อ',
			none: 'รับ 0 มื้อ'
		});
		expect(coverageStatusLabels(true)).toEqual({
			complete: 'รับ 2 มื้อขึ้นไปทุกวัน',
			incomplete: 'รับไม่ถึง 2 มื้อบางวัน',
			partial: 'รับไม่ถึง 2 มื้อบางวัน',
			none: 'รับ 0 มื้อทั้งช่วง'
		});
	});
});

describe('donutSegments', () => {
	const C = 100;

	it('lists complete, partial, none in that order with their share of the circle', () => {
		const segs = donutSegments({ complete: 50, partial: 25, none: 25 }, C, 0);
		expect(segs.map((s) => [s.status, s.length, s.start])).toEqual([
			['complete', 50, 0],
			['partial', 25, 50],
			['none', 25, 75]
		]);
	});

	it('leaves a small gap after each segment when more than one is drawn', () => {
		const segs = donutSegments({ complete: 50, partial: 25, none: 25 }, C, 2);
		expect(segs.map((s) => [s.status, s.length, s.start])).toEqual([
			['complete', 48, 0],
			['partial', 23, 50],
			['none', 23, 75]
		]);
	});

	it('skips a status with nobody and draws a lone status as a full ring without a gap', () => {
		expect(donutSegments({ complete: 3, partial: 0, none: 0 }, C, 2)).toEqual([
			{ status: 'complete', length: 100, start: 0 }
		]);
		expect(donutSegments({ complete: 1, partial: 0, none: 1 }, C, 0).map((s) => s.status)).toEqual([
			'complete',
			'none'
		]);
	});

	it('draws nothing for nobody', () => {
		expect(donutSegments({ complete: 0, partial: 0, none: 0 }, C, 2)).toEqual([]);
	});
});

describe('coverageFilterLabels', () => {
	it('names every filter, the same set for a day and for a range', () => {
		const day = coverageFilterLabels(false);
		expect(Object.keys(day)).toEqual([
			'all',
			'complete',
			'incomplete',
			'partial',
			'none',
			'part_day'
		]);
		expect(day.all).toBe('ทั้งหมด');
		expect(day.complete).toBe('รับ 2 มื้อขึ้นไป/วัน');
		expect(day.incomplete).toBe('รับไม่ถึง 2 มื้อ/วัน');
		expect(day.partial).toBe('รับแค่ 1 มื้อ');
		expect(day.none).toBe('รับ 0 มื้อ');
		expect(day.part_day).toBe('อยู่ในศูนย์ไม่เต็มวัน (ไม่นับเกณฑ์)');
		const range = coverageFilterLabels(true);
		expect(range.complete).toBe('รับ 2 มื้อขึ้นไปทุกวัน');
		// The union and the one-meal group would read the same over a range: the union says so.
		expect(range.incomplete).toBe('รับไม่ถึง 2 มื้อบางวัน (รวมทุกกลุ่ม)');
		expect(range.partial).toBe('รับไม่ถึง 2 มื้อบางวัน');
		expect(range.none).toBe('รับ 0 มื้อทั้งช่วง');
	});
});
