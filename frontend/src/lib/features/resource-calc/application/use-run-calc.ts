/**
 * T-31.5 — on-demand recalculation of a day's resource snapshot.
 *
 * Wraps `runOnDemand` (idempotent on `daily_calc:{date}`; writes an
 * `audit:{action:retro_edit}` before overwriting). Invalidates eagerly on
 * success for instant UI update; the changes feed (`calc-sync.ts`) also fires.
 */
import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import type { AuthorContext } from '$lib/db/model';
import { dailyCalcRepository } from '../data/daily-calc.remote';
import { calcKeys } from './queries';

export const useRunCalc = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ date, ctx }: { date: string; ctx: AuthorContext }) =>
			dailyCalcRepository().runOnDemand(date, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: calcKeys.all });
		}
	}));
};
