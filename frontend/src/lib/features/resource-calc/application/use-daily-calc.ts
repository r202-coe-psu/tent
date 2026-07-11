/**
 * T-31.5 — read one day's persisted daily_calc snapshot.
 *
 * Reactivity comes from the changes feed (see `calc-sync.ts`), never polling —
 * no `refetchInterval`.
 */
import { createQuery } from '@tanstack/svelte-query';
import { dailyCalcRepository } from '../data/daily-calc.remote';
import { calcKeys } from './queries';

/** Query the stored snapshot for `date` (`YYYY-MM-DD`); disabled while `date` is empty. */
export const useDailyCalc = (date: () => string) =>
	createQuery(() => ({
		queryKey: calcKeys.byDate(date()),
		queryFn: () => dailyCalcRepository().get(date()),
		enabled: !!date()
	}));
