import { describe, expect, it } from 'vitest';
import type { MealPeriod } from './shared';
import {
	COVERAGE_MEALS,
	countingLogsByRecipient,
	dailyMealTrend,
	distributedPortionsByMeal,
	mealCoverageShares,
	otherRecipientsByMeal,
	portionsByDistributor,
	mealCoverageRoster,
	unscannedMeals,
	type CoverageDay,
	type CoverageLog,
	type CoverageResident
} from './meal-coverage';

const DAY = '2026-11-09';
const A: CoverageResident = { id: 'evacuee:A', name: 'สมชาย', presence: { [DAY]: 'all' } };
const B: CoverageResident = { id: 'evacuee:B', name: 'สมหญิง', presence: { [DAY]: 'all' } };
/** In the shelter only part of `DAY`. */
const partly = (r: CoverageResident): CoverageResident => ({
	...r,
	presence: { [DAY]: 'partial' }
});
const dayOf = (servedMeals: readonly MealPeriod[] = COVERAGE_MEALS, day = DAY): CoverageDay => ({
	day,
	servedMeals
});

const log = (over: Partial<CoverageLog> = {}): CoverageLog => ({
	recipient_type: 'evacuee',
	recipient_id: 'evacuee:A',
	meal: 'breakfast',
	status: 'fulfilled',
	is_returnable: false,
	distributed_at: '2026-11-09T01:00:00Z',
	distributed_by: 'staff1',
	qty: '1',
	...over
});

// CR-240: a household member collects for others; the log keeps the eater as recipient_id.
const collectedFor = (recipient: string, meal: 'breakfast' | 'lunch') =>
	Object.assign(log({ recipient_id: recipient, meal }), { collected_by_recipient_id: 'evacuee:A' });

const roster = (residents = [A], logs: CoverageLog[] = [], servedMeals?: readonly MealPeriod[]) =>
	mealCoverageRoster({ days: [dayOf(servedMeals)], residents, logs });
const incomplete = (...args: Parameters<typeof roster>) =>
	roster(...args).filter((r) => !r.complete);
const run = (residents = [A], logs: CoverageLog[] = []) => incomplete(residents, logs);

describe('mealCoverageRoster', () => {
	it('does not list someone who got breakfast and lunch', () => {
		expect(run([A], [log(), log({ meal: 'lunch' })])).toEqual([]);
	});

	it('lists someone with one meal, with the missing meals', () => {
		expect(run([A], [log()])).toEqual([
			{
				id: 'evacuee:A',
				name: 'สมชาย',
				received: ['breakfast'],
				missing: ['lunch', 'dinner'],
				counted: 1,
				complete: false,
				distributedBy: ['staff1'],
				judgedDays: 1,
				shortDays: 1,
				partialDays: 0,
				mealsReceived: 1
			}
		]);
	});

	it('lists a resident with no logs at all', () => {
		expect(run([A], [])).toEqual([
			{
				id: 'evacuee:A',
				name: 'สมชาย',
				received: [],
				missing: ['breakfast', 'lunch', 'dinner'],
				counted: 0,
				complete: false,
				distributedBy: [],
				judgedDays: 1,
				shortDays: 1,
				partialDays: 0,
				mealsReceived: 0
			}
		]);
	});

	it('counts the same meal received twice (override) once', () => {
		const rows = run([A], [log(), log({ distributed_at: '2026-11-09T01:30:00Z' })]);
		expect(rows[0].received).toEqual(['breakfast']);
	});

	it('ignores voided logs', () => {
		const rows = run([A], [log(), log({ meal: 'lunch', status: 'voided' })]);
		expect(rows[0].received).toEqual(['breakfast']);
	});

	it('ignores returnable loans', () => {
		const rows = run([A], [log(), log({ meal: 'lunch', is_returnable: true })]);
		expect(rows[0].received).toEqual(['breakfast']);
	});

	it('ignores logs without a meal', () => {
		const rows = run([A], [log(), log({ meal: undefined })]);
		expect(rows[0].received).toEqual(['breakfast']);
	});

	it('does not count a snack as a meal', () => {
		const rows = run([A], [log(), log({ meal: 'snack' })]);
		expect(rows[0].received).toEqual(['breakfast']);
	});

	it('uses the Thai calendar day (17:00Z is midnight in Thailand)', () => {
		// 2026-11-09T17:30Z = 00:30 on 10 Nov in Thailand; 2026-11-08T16:59Z = 23:59 on 8 Nov
		const outside = [
			log({ meal: 'dinner', distributed_at: '2026-11-09T17:30:00Z' }),
			log({ meal: 'lunch', distributed_at: '2026-11-08T16:59:00Z' })
		];
		expect(run([A], [log(), ...outside])[0].received).toEqual(['breakfast']);
		// 2026-11-08T17:00Z = 00:00 on 9 Nov, 2026-11-09T16:59Z = 23:59 on 9 Nov: both inside
		const inside = [
			log({ meal: 'lunch', distributed_at: '2026-11-08T17:00:00Z' }),
			log({ meal: 'dinner', distributed_at: '2026-11-09T16:59:00Z' })
		];
		expect(run([A], inside)).toEqual([]);
	});

	it('counts for recipient_id, not for whoever collected on their behalf', () => {
		const rows = run(
			[A, B],
			[collectedFor('evacuee:B', 'breakfast'), collectedFor('evacuee:B', 'lunch')]
		);
		expect(rows.map((r) => r.id)).toEqual(['evacuee:A']);
	});

	it('does not create rows for volunteer, staff or outside recipients', () => {
		const rows = run(
			[A],
			[
				log({ recipient_type: 'volunteer', recipient_id: 'volunteer:V' }),
				log({ recipient_type: 'staff', recipient_id: 'user:s' }),
				log({ recipient_type: 'outside', recipient_id: null })
			]
		);
		expect(rows.map((r) => r.id)).toEqual(['evacuee:A']);
	});

	it('does not list someone who was not in the shelter at any time of the day', () => {
		expect(roster([{ ...A, presence: { [DAY]: 'none' } }], [log()])).toEqual([]);
	});

	it('returns every present resident, flagging who met the threshold', () => {
		const rows = roster([A, B], [log(), log({ meal: 'lunch' })]);
		expect(rows.map((r) => [r.id, r.complete])).toEqual([
			['evacuee:A', true],
			['evacuee:B', false]
		]);
		expect(rows[0]).toMatchObject({ received: ['breakfast', 'lunch'], missing: ['dinner'] });
	});

	it('lists the distinct distributed_by of the counting logs in first-seen order', () => {
		const logs = [
			log({ distributed_by: 'zed' }),
			log({ meal: 'lunch', distributed_by: 'amy' }),
			log({ meal: 'dinner', distributed_by: 'zed' }),
			log({ meal: 'lunch', status: 'voided', distributed_by: 'voider' }),
			log({ meal: 'snack', distributed_by: 'snacker' }),
			log({ recipient_id: 'evacuee:B', distributed_by: 'other' })
		];
		expect(roster([A, B], logs).map((r) => r.distributedBy)).toEqual([['zed', 'amy'], ['other']]);
	});
});

describe('mealCoverageRoster for someone there only part of the day', () => {
	it('lists them as partial, with the meals they got, never judged as short', () => {
		const rows = roster([partly(A)], [log()]);
		expect(rows).toEqual([
			{
				id: 'evacuee:A',
				name: 'สมชาย',
				received: ['breakfast'],
				missing: ['lunch', 'dinner'],
				counted: 0,
				complete: false,
				distributedBy: ['staff1'],
				judgedDays: 0,
				shortDays: 0,
				partialDays: 1,
				mealsReceived: 1
			}
		]);
	});

	it('lists them even with no record at all', () => {
		expect(roster([partly(A)], [])).toHaveLength(1);
	});
});

describe('mealCoverageRoster over a range of days', () => {
	const D8 = '2026-11-08';
	const D10 = '2026-11-10';
	const everyDay = (id: string, presence: CoverageResident['presence']): CoverageResident => ({
		id,
		name: id,
		presence
	});
	const at = (day: string, meal: MealPeriod, over: Partial<CoverageLog> = {}) =>
		log({ meal, distributed_at: `${day}T01:00:00Z`, ...over });
	const range = (residents: CoverageResident[], logs: CoverageLog[], days = [D8, DAY, D10]) =>
		mealCoverageRoster({ days: days.map((d) => dayOf(COVERAGE_MEALS, d)), residents, logs });

	it('counts the days someone was there all day with fewer than 2 meals', () => {
		const resident = everyDay('evacuee:A', { [D8]: 'all', [DAY]: 'all', [D10]: 'all' });
		const rows = range(
			[resident],
			[at(D8, 'breakfast'), at(D8, 'lunch'), at(DAY, 'breakfast'), at(D10, 'dinner', {})]
		);
		expect(rows[0]).toMatchObject({
			judgedDays: 3,
			shortDays: 2,
			counted: 4,
			mealsReceived: 4,
			complete: false,
			missing: [],
			received: ['breakfast', 'lunch', 'dinner']
		});
	});

	it('is complete when no day was short', () => {
		const resident = everyDay('evacuee:A', { [D8]: 'all', [DAY]: 'all' });
		const logs = [at(D8, 'breakfast'), at(D8, 'lunch'), at(DAY, 'lunch'), at(DAY, 'dinner')];
		expect(range([resident], logs, [D8, DAY])[0]).toMatchObject({
			judgedDays: 2,
			shortDays: 0,
			complete: true
		});
	});

	it('judges only the days they were there all day; part days and absent days are not judged', () => {
		const resident = everyDay('evacuee:A', { [D8]: 'none', [DAY]: 'partial', [D10]: 'all' });
		const rows = range([resident], [at(DAY, 'breakfast')]);
		expect(rows[0]).toMatchObject({
			judgedDays: 1,
			shortDays: 1,
			partialDays: 1,
			mealsReceived: 1,
			counted: 0
		});
	});

	it('judges a running day against 2 meals even when only breakfast is served so far', () => {
		const days = [dayOf(COVERAGE_MEALS, DAY), dayOf(['breakfast'], D10)];
		const resident = everyDay('evacuee:A', { [DAY]: 'all', [D10]: 'all' });
		const rows = mealCoverageRoster({
			days,
			residents: [resident],
			logs: [at(DAY, 'breakfast'), at(DAY, 'lunch'), at(D10, 'breakfast')]
		});
		expect(rows[0]).toMatchObject({ judgedDays: 2, shortDays: 1, counted: 3, complete: false });
	});

	it('judges a running day on which no meal was served yet as 0 of 2', () => {
		const days = [dayOf(COVERAGE_MEALS, DAY), dayOf([], D10)];
		const resident = everyDay('evacuee:A', { [DAY]: 'all', [D10]: 'all' });
		const rows = mealCoverageRoster({ days, residents: [resident], logs: [] });
		expect(rows[0]).toMatchObject({ judgedDays: 2, shortDays: 2 });
	});

	it('leaves out someone who was never there during the range', () => {
		expect(range([everyDay('evacuee:A', {})], [at(DAY, 'breakfast')])).toEqual([]);
	});

	it('merges the distributors of every day', () => {
		const resident = everyDay('evacuee:A', { [D8]: 'all', [DAY]: 'all' });
		const logs = [
			at(D8, 'breakfast', { distributed_by: 'amy' }),
			at(DAY, 'lunch', { distributed_by: 'bob' })
		];
		expect(range([resident], logs, [D8, DAY])[0].distributedBy).toEqual(['amy', 'bob']);
	});
});

describe('mealCoverageRoster on a running day (served meals)', () => {
	const today = (servedMeals: MealPeriod[], residents = [A], logs: CoverageLog[] = []) =>
		incomplete(residents, logs, servedMeals);

	it('lists everyone as under 2 meals when no meal has been served yet, with nothing missing', () => {
		expect(today([])).toEqual([
			expect.objectContaining({ id: 'evacuee:A', missing: [], counted: 0, complete: false })
		]);
	});

	it('with only breakfast served, nobody reaches 2 meals; missing lists only the served breakfast', () => {
		const rows = today(['breakfast'], [A, B], [log({ recipient_id: 'evacuee:A' })]);
		expect(rows).toEqual([
			expect.objectContaining({ id: 'evacuee:A', missing: [], counted: 1, complete: false }),
			expect.objectContaining({ id: 'evacuee:B', missing: ['breakfast'], counted: 0 })
		]);
	});

	it('does not count a meal that is not served yet toward complete', () => {
		const rows = today(['breakfast'], [A], [log({ meal: 'dinner' })]);
		expect(rows).toEqual([
			expect.objectContaining({ received: ['dinner'], counted: 0, complete: false })
		]);
	});

	it('lists in missing only served meals', () => {
		const rows = today(['breakfast', 'lunch'], [A], [log({ meal: 'lunch' })]);
		expect(rows).toEqual([
			{
				id: 'evacuee:A',
				name: 'สมชาย',
				received: ['lunch'],
				missing: ['breakfast'],
				counted: 1,
				complete: false,
				distributedBy: ['staff1'],
				judgedDays: 1,
				shortDays: 1,
				partialDays: 0,
				mealsReceived: 1
			}
		]);
	});

	it('is complete only with two served meals on record, whatever else is served', () => {
		const two = [log(), log({ meal: 'lunch' })];
		expect(today(['breakfast', 'lunch'], [A], [log()])).toHaveLength(1);
		expect(today(['breakfast', 'lunch', 'dinner'], [A], [log()])).toHaveLength(1);
		expect(today(['breakfast'], [A], two)).toHaveLength(1);
		expect(today(['breakfast', 'lunch'], [A], two)).toEqual([]);
	});

	it('defaults to every coverage meal, as for a finished day', () => {
		expect(run([A], [log()])[0].missing).toEqual(['lunch', 'dinner']);
	});
});

describe('countingLogsByRecipient', () => {
	it('counts only evacuee logs of the day that servedMealOfLog accepts', () => {
		const map = countingLogsByRecipient(
			[
				log(),
				log({ meal: 'snack' }),
				log({ status: 'voided', meal: 'lunch' }),
				log({ distributed_at: '2026-11-09T17:30:00Z', meal: 'dinner' }),
				log({ recipient_type: 'volunteer', recipient_id: 'volunteer:V' })
			],
			DAY
		);
		expect([...map.keys()]).toEqual(['evacuee:A']);
		expect([...(map.get('evacuee:A')?.meals ?? [])]).toEqual(['breakfast']);
	});
});

describe('unscannedMeals', () => {
	const unscanned = (logs: CoverageLog[], servedMeals: readonly MealPeriod[] = COVERAGE_MEALS) =>
		unscannedMeals({ days: [dayOf(servedMeals)], residents: [A], logs });

	it('returns the served meals with no log from anybody that day', () => {
		const logs = [log({ recipient_id: 'evacuee:Z', meal: 'lunch' })];
		expect(unscanned(logs)).toEqual([
			{ day: DAY, meal: 'breakfast' },
			{ day: DAY, meal: 'dinner' }
		]);
	});

	it('counts a log of any recipient type as a meal that was handed out', () => {
		const logs = [
			log({ recipient_type: 'outside', recipient_id: null, meal: 'breakfast' }),
			log({ recipient_type: 'volunteer', recipient_id: 'volunteer:V', meal: 'lunch' }),
			log({ recipient_type: 'staff', recipient_id: 'user:s', meal: 'dinner' })
		];
		expect(unscanned(logs)).toEqual([]);
	});

	it('ignores meals that are not served yet', () => {
		expect(unscanned([], ['breakfast'])).toEqual([{ day: DAY, meal: 'breakfast' }]);
	});

	it('does not count a voided log as a hand-over', () => {
		expect(unscanned([log({ status: 'voided' })], ['breakfast'])).toEqual([
			{ day: DAY, meal: 'breakfast' }
		]);
	});

	it('names the day and the meal for each day of a range', () => {
		const days = [dayOf(COVERAGE_MEALS, '2026-11-08'), dayOf(COVERAGE_MEALS, DAY)];
		const everyone = { ...A, presence: { '2026-11-08': 'all', [DAY]: 'all' } } as const;
		const logs = [
			log({ distributed_at: '2026-11-08T01:00:00Z', meal: 'breakfast' }),
			log({ distributed_at: '2026-11-08T05:00:00Z', meal: 'lunch' }),
			log({ distributed_at: '2026-11-08T11:00:00Z', meal: 'dinner' }),
			log({ meal: 'breakfast' }),
			log({ meal: 'lunch' })
		];
		expect(unscannedMeals({ days, residents: [everyone], logs })).toEqual([
			{ day: DAY, meal: 'dinner' }
		]);
	});

	it('says nothing for a day when nobody was in the shelter all of it', () => {
		const days = [dayOf(COVERAGE_MEALS)];
		expect(unscannedMeals({ days, residents: [partly(A)], logs: [] })).toEqual([]);
	});
});

describe('mealCoverageShares (#1257)', () => {
	const C = partly({ id: 'evacuee:C', name: 'สมศรี', presence: {} });
	const logs = [
		log(),
		log({ meal: 'lunch' }),
		log({ recipient_id: 'evacuee:B' }),
		log({ recipient_id: 'evacuee:C', meal: 'dinner' })
	];
	const shares = (residents: CoverageResident[], servedMeals?: readonly MealPeriod[]) =>
		mealCoverageShares({ days: [dayOf(servedMeals)], residents, logs });

	it('counts per meal over the residents who were in the shelter all day', () => {
		expect(shares([A, B])).toEqual({
			present: 2,
			meals: [
				{ meal: 'breakfast', served: true, recorded: 2, total: 2 },
				{ meal: 'lunch', served: true, recorded: 1, total: 2 },
				{ meal: 'dinner', served: true, recorded: 0, total: 2 }
			],
			complete: 1
		});
	});

	it('counts the meals of someone there only part of the day, and no meal they have no record of', () => {
		expect(shares([A, B, C])).toEqual({
			present: 2,
			meals: [
				{ meal: 'breakfast', served: true, recorded: 2, total: 2 },
				{ meal: 'lunch', served: true, recorded: 1, total: 2 },
				{ meal: 'dinner', served: true, recorded: 1, total: 3 }
			],
			complete: 1
		});
	});

	it('on a running day marks unserved meals, and the bar for complete stays at 2 served meals', () => {
		const result = shares([A, B], ['breakfast']);
		expect(result.meals.map((m) => m.served)).toEqual([true, false, false]);
		expect(result.present).toBe(2);
		expect(result.complete).toBe(0);
	});

	it('adds up with the list: complete plus listed rows is everyone present', () => {
		const listed = incomplete([A, B, C], logs).filter((r) => r.judgedDays > 0).length;
		const result = shares([A, B, C]);
		expect(result.complete + listed).toBe(result.present); // C is listed but never judged
	});

	it('sums person-days over a range, counting each day separately', () => {
		const days = [dayOf(COVERAGE_MEALS, '2026-11-08'), dayOf(COVERAGE_MEALS, DAY)];
		const both = { ...A, presence: { '2026-11-08': 'all', [DAY]: 'all' } } as const;
		const result = mealCoverageShares({
			days,
			residents: [both],
			logs: [
				log({ distributed_at: '2026-11-08T01:00:00Z' }),
				log({ distributed_at: '2026-11-08T05:00:00Z', meal: 'lunch' }),
				log()
			]
		});
		expect(result).toEqual({
			present: 2,
			meals: [
				{ meal: 'breakfast', served: true, recorded: 2, total: 2 },
				{ meal: 'lunch', served: true, recorded: 1, total: 2 },
				{ meal: 'dinner', served: true, recorded: 0, total: 2 }
			],
			complete: 1
		});
	});
});

describe('distributedPortionsByMeal', () => {
	const portions = (logs: CoverageLog[]) => distributedPortionsByMeal(logs, DAY);

	it('is zero for every meal without logs', () => {
		expect(portions([])).toEqual({ breakfast: 0, lunch: 0, dinner: 0 });
	});

	it('sums qty per meal, not the number of logs', () => {
		const logs = [log({ qty: '3' }), log({ qty: '2' }), log({ meal: 'dinner', qty: '4' })];
		expect(portions(logs)).toEqual({ breakfast: 5, lunch: 0, dinner: 4 });
	});

	it('counts volunteer and staff portions too', () => {
		const logs = [log({ recipient_type: 'volunteer', recipient_id: null, qty: '2' }), log()];
		expect(portions(logs).breakfast).toBe(3);
	});

	it('ignores voided logs, loans, logs without a meal and snacks', () => {
		const logs = [
			log({ status: 'voided' }),
			log({ is_returnable: true }),
			log({ meal: undefined }),
			log({ meal: 'snack' })
		];
		expect(portions(logs)).toEqual({ breakfast: 0, lunch: 0, dinner: 0 });
	});

	it('ignores logs of another Thai day', () => {
		const logs = [log({ distributed_at: '2026-11-08T01:00:00Z' }), log()];
		expect(portions(logs).breakfast).toBe(1);
	});

	it('counts a log with an unreadable qty as zero', () => {
		const logs = [log({ qty: 'abc' }), log({ qty: undefined as unknown as string }), log()];
		expect(portions(logs).breakfast).toBe(1);
	});
});

describe('portionsByDistributor', () => {
	it('sums portions per distributor, most first, ties by name', () => {
		const logs = [
			log({ distributed_by: 'bob', qty: '2' }),
			log({ distributed_by: 'amy', meal: 'lunch', qty: '1' }),
			log({ distributed_by: 'bob', meal: 'dinner', qty: '1' }),
			log({ distributed_by: 'cat', meal: 'lunch', qty: '3' })
		];
		expect(portionsByDistributor(logs, DAY)).toEqual([
			{ by: 'bob', portions: 3 },
			{ by: 'cat', portions: 3 },
			{ by: 'amy', portions: 1 }
		]);
	});

	it('leaves out voided logs, snacks, loans and other days, and counts every recipient type', () => {
		const logs = [
			log({ distributed_by: 'amy', status: 'voided' }),
			log({ distributed_by: 'amy', meal: 'snack' }),
			log({ distributed_by: 'amy', is_returnable: true }),
			log({ distributed_by: 'amy', distributed_at: '2026-11-08T01:00:00Z' }),
			log({ distributed_by: 'bob', recipient_type: 'volunteer', recipient_id: null })
		];
		expect(portionsByDistributor(logs, DAY)).toEqual([{ by: 'bob', portions: 1 }]);
	});
});

describe('portions over a range of days', () => {
	const range = { from: '2026-11-08', to: '2026-11-10' };
	const logs = [
		log({ distributed_at: '2026-11-07T16:59:00Z', qty: '9' }), // 07 Nov 23:59 Thai: before
		log({ distributed_at: '2026-11-07T17:00:00Z', qty: '1', distributed_by: 'amy' }), // 08 Nov
		log({ distributed_at: '2026-11-09T01:00:00Z', qty: '2', distributed_by: 'amy' }),
		log({
			distributed_at: '2026-11-10T05:00:00Z',
			meal: 'dinner',
			qty: '4',
			distributed_by: 'bob'
		}),
		log({ distributed_at: '2026-11-10T17:00:00Z', qty: '9' }) // 11 Nov 00:00 Thai: after
	];

	it('sums the portions per meal over every day of the range', () => {
		expect(distributedPortionsByMeal(logs, range)).toEqual({ breakfast: 3, lunch: 0, dinner: 4 });
	});

	it('sums the portions per distributor over every day of the range', () => {
		expect(portionsByDistributor(logs, range)).toEqual([
			{ by: 'bob', portions: 4 },
			{ by: 'amy', portions: 3 }
		]);
	});
});

describe('otherRecipientsByMeal', () => {
	const other = (over: Partial<CoverageLog>) =>
		log({ recipient_type: 'outside', recipient_id: null, ...over });

	it('tallies outside, volunteer and staff hand-overs per meal as portions', () => {
		const logs = [
			other({ qty: '2' }),
			other({ qty: '3', distributed_at: '2026-11-10T01:00:00Z' }),
			other({ meal: 'dinner', qty: '1' }),
			log({ recipient_type: 'volunteer', recipient_id: 'volunteer:V', qty: '4' }),
			log({ recipient_type: 'staff', recipient_id: 'user:s', meal: 'lunch', qty: '2' }),
			log({ qty: '7' }) // an evacuee is not in this tally
		];
		expect(otherRecipientsByMeal(logs, { from: DAY, to: '2026-11-10' })).toEqual([
			{
				meal: 'breakfast',
				outside: 5,
				volunteer: 4,
				staff: 0
			},
			{
				meal: 'lunch',
				outside: 0,
				volunteer: 0,
				staff: 2
			},
			{
				meal: 'dinner',
				outside: 1,
				volunteer: 0,
				staff: 0
			}
		]);
	});

	it('ignores voided logs, loans, snacks and other days', () => {
		const logs = [
			other({ status: 'voided' }),
			other({ is_returnable: true }),
			other({ meal: 'snack' }),
			other({ distributed_at: '2026-11-08T01:00:00Z' })
		];
		expect(otherRecipientsByMeal(logs, DAY).every((m) => m.outside === 0)).toBe(true);
	});
});

describe('dailyMealTrend', () => {
	it('gives portions per meal and distinct evacuees with a record for every day, zeros included', () => {
		const logs = [
			log({ qty: '2' }),
			log({ recipient_id: 'evacuee:B', qty: '1' }),
			log({ meal: 'lunch', qty: '1' }), // A again: still one person
			log({ recipient_type: 'outside', recipient_id: null, meal: 'dinner', qty: '3' }),
			log({ distributed_at: '2026-11-10T01:00:00Z', meal: 'dinner', qty: '5' })
		];
		expect(dailyMealTrend(logs, [DAY, '2026-11-10', '2026-11-11'])).toEqual([
			{ day: DAY, portions: { breakfast: 3, lunch: 1, dinner: 3 }, people: 2 },
			{ day: '2026-11-10', portions: { breakfast: 0, lunch: 0, dinner: 5 }, people: 1 },
			{ day: '2026-11-11', portions: { breakfast: 0, lunch: 0, dinner: 0 }, people: 0 }
		]);
	});
});
