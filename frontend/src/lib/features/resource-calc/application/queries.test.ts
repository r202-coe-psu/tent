// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';

vi.mock('$lib/db/shelter', () => ({ getShelterDb: () => 'shelter_sh001' }));

const mockGet = vi.fn();
const mockRunOnDemand = vi.fn();
const mockListRange = vi.fn();
vi.mock('../data/daily-calc.remote', () => ({
	dailyCalcRepository: () => ({
		get: mockGet,
		runOnDemand: mockRunOnDemand,
		listRange: mockListRange
	})
}));

const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/svelte-query', () => ({
	createQuery: (fn: () => unknown) => fn(),
	useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
	createMutation: (fn: () => Record<string, unknown>) => {
		const options = fn();
		return {
			mutate: async (variables: unknown) => {
				const mutationFn = options.mutationFn as (v: unknown) => Promise<unknown>;
				const onSuccess = options.onSuccess as ((d: unknown, v: unknown) => void) | undefined;
				const data = await mutationFn(variables);
				onSuccess?.(data, variables);
				return data;
			}
		};
	}
}));

// Capture subscribeDataChanges registrations to assert the type→keys mapping.
const subscribeCalls: Array<{ db: unknown; keysForType: (t: string) => unknown }> = [];
vi.mock('$lib/db/subscribe-data-changes', () => ({
	subscribeDataChanges: (_qc: unknown, db: unknown, keysForType: (t: string) => unknown) => {
		subscribeCalls.push({ db, keysForType });
		return { stop: vi.fn() };
	}
}));

import { calcKeys } from './queries';
import { useDailyCalc } from './use-daily-calc';
import { useRunCalc } from './use-run-calc';
import { useCalcRange } from './use-calc-range';
import { startDailyCalcLiveQuery } from './calc-sync';

beforeEach(() => {
	vi.clearAllMocks();
	subscribeCalls.length = 0;
});

describe('useDailyCalc', () => {
	it('builds a date-scoped key and is enabled only when date is set', () => {
		expect(useDailyCalc(() => '2026-07-08')).toMatchObject({
			queryKey: calcKeys.byDate('2026-07-08'),
			enabled: true
		});
		expect(useDailyCalc(() => '')).toMatchObject({ enabled: false });
	});

	it('queryFn reads through the repository', () => {
		const q = useDailyCalc(() => '2026-07-08') as unknown as { queryFn: () => unknown };
		q.queryFn();
		expect(mockGet).toHaveBeenCalledWith('2026-07-08');
	});
});

describe('useCalcRange', () => {
	it('builds a range key and is enabled only when both bounds are set', () => {
		expect(
			useCalcRange(
				() => '2026-07-06',
				() => '2026-07-10'
			)
		).toMatchObject({
			queryKey: calcKeys.range('2026-07-06', '2026-07-10'),
			enabled: true
		});
		expect(
			useCalcRange(
				() => '2026-07-06',
				() => ''
			)
		).toMatchObject({ enabled: false });
	});
});

describe('useRunCalc', () => {
	it('runs on-demand and invalidates all daily-calc keys', async () => {
		mockRunOnDemand.mockResolvedValue({ _id: 'daily_calc:2026-07-08' });
		const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };
		const mutation = useRunCalc();

		await mutation.mutate({ date: '2026-07-08', ctx });

		expect(mockRunOnDemand).toHaveBeenCalledWith('2026-07-08', ctx);
		expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: calcKeys.all });
	});
});

describe('startDailyCalcLiveQuery', () => {
	it('invalidates on daily_calc + active-ratio changes, ignoring unrelated types', () => {
		startDailyCalcLiveQuery({} as never);

		expect(subscribeCalls).toHaveLength(2);
		const catalog = subscribeCalls.find((c) => c.db === 'catalog')!;
		const shelter = subscribeCalls.find((c) => typeof c.db === 'function')!;

		// catalog DB → only sop_profile matters
		expect(catalog.keysForType('sop_profile')).toEqual([calcKeys.all]);
		expect(catalog.keysForType('daily_calc')).toEqual([]);

		// shelter DB → daily_calc + sop_override matter
		expect(shelter.keysForType('daily_calc')).toEqual([calcKeys.all]);
		expect(shelter.keysForType('sop_override')).toEqual([calcKeys.all]);
		expect(shelter.keysForType('donation')).toEqual([]);
	});
});
