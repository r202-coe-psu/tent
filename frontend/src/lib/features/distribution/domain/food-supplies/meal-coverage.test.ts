import { describe, expect, it } from 'vitest';
import type { MealPeriod } from './shared';
import {
	COVERAGE_MEALS,
	MIN_MEALS_PER_DAY,
	countingLogsByRecipient,
	coverageThreshold,
	distributedPortionsByMeal,
	mealCoverageShares,
	portionsByDistributor,
	mealCoverageRoster,
	unscannedMeals,
	type CoverageLog
} from './meal-coverage';

const DAY = '2026-11-09';
const A = { id: 'evacuee:A', name: 'สมชาย', presentAllDay: true };
const B = { id: 'evacuee:B', name: 'สมหญิง', presentAllDay: true };

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
	mealCoverageRoster({ day: DAY, residents, logs, servedMeals });
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
				distributedBy: ['staff1']
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
				distributedBy: []
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

	it('does not list residents who were not in the shelter all day', () => {
		expect(roster([{ ...A, presentAllDay: false }], [])).toEqual([]);
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

describe('mealCoverageRoster on a running day (served meals)', () => {
	const today = (servedMeals: MealPeriod[], residents = [A], logs: CoverageLog[] = []) =>
		incomplete(residents, logs, servedMeals);

	it('lists nobody when no meal has been served yet', () => {
		expect(today([])).toEqual([]);
	});

	it('with only breakfast served, drops who has breakfast and keeps who has none', () => {
		const rows = today(['breakfast'], [A, B], [log({ recipient_id: 'evacuee:A' })]);
		expect(rows).toEqual([
			{
				id: 'evacuee:B',
				name: 'สมหญิง',
				received: [],
				missing: ['breakfast'],
				counted: 0,
				complete: false,
				distributedBy: []
			}
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
				distributedBy: ['staff1']
			}
		]);
	});

	it('still needs two records once two or more meals are served', () => {
		const logs = [log()];
		expect(today(['breakfast', 'lunch'], [A], logs)).toHaveLength(1);
		expect(today(['breakfast', 'lunch', 'dinner'], [A], logs)).toHaveLength(1);
		expect(today(['breakfast', 'lunch'], [A], [log(), log({ meal: 'lunch' })])).toEqual([]);
	});

	it('defaults to every coverage meal, as for a finished day', () => {
		expect(run([A], [log()])[0].missing).toEqual(['lunch', 'dinner']);
	});
});

describe('coverageThreshold', () => {
	it('is capped by the number of served meals', () => {
		expect(coverageThreshold(['breakfast'])).toBe(1);
		expect(coverageThreshold(['breakfast', 'lunch', 'dinner'])).toBe(MIN_MEALS_PER_DAY);
		expect(coverageThreshold([])).toBe(0);
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
	it('returns served meals with no counting log from anybody that day', () => {
		const logs = [log({ recipient_id: 'evacuee:Z', meal: 'lunch' })];
		expect(unscannedMeals({ day: DAY, logs, servedMeals: COVERAGE_MEALS })).toEqual([
			'breakfast',
			'dinner'
		]);
	});

	it('ignores meals that are not served yet', () => {
		expect(unscannedMeals({ day: DAY, logs: [], servedMeals: ['breakfast'] })).toEqual([
			'breakfast'
		]);
	});

	it('does not count a voided log as a scan', () => {
		const logs = [log({ status: 'voided' })];
		expect(unscannedMeals({ day: DAY, logs, servedMeals: ['breakfast'] })).toEqual(['breakfast']);
	});
});

describe('mealCoverageShares (#1257)', () => {
	const C = { id: 'evacuee:C', name: 'สมศรี', presentAllDay: false };
	const logs = [
		log(),
		log({ meal: 'lunch' }),
		log({ recipient_id: 'evacuee:B' }),
		log({ recipient_id: 'evacuee:C', meal: 'dinner' })
	];

	it('counts per meal over the residents who were in the shelter all day', () => {
		expect(mealCoverageShares({ day: DAY, residents: [A, B, C], logs })).toEqual({
			present: 2,
			meals: [
				{ meal: 'breakfast', served: true, recorded: 2 },
				{ meal: 'lunch', served: true, recorded: 1 },
				{ meal: 'dinner', served: true, recorded: 0 }
			],
			complete: 1
		});
	});

	it('on a running day marks unserved meals and lowers the bar for complete', () => {
		const shares = mealCoverageShares({
			day: DAY,
			residents: [A, B],
			logs,
			servedMeals: ['breakfast']
		});
		expect(shares.meals.map((m) => m.served)).toEqual([true, false, false]);
		expect(shares.complete).toBe(2);
	});

	it('adds up with the list: complete plus listed rows is everyone present', () => {
		const listed = incomplete([A, B, C], logs).length;
		const shares = mealCoverageShares({ day: DAY, residents: [A, B, C], logs });
		expect(shares.complete + listed).toBe(shares.present);
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
