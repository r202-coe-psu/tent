/**
 * T-31.5 — read persisted daily_calc snapshots across a date range (for the
 * T-32 trend view). Backed by a bounded `listRange` scan, not a full collection read.
 */
import { createQuery } from '@tanstack/svelte-query';
import { dailyCalcRepository } from '../data/daily-calc.remote';
import { calcKeys } from './queries';

/** Query snapshots for the inclusive range `[from, to]` (`YYYY-MM-DD`); disabled until both are set. */
export const useCalcRange = (from: () => string, to: () => string) =>
	createQuery(() => ({
		queryKey: calcKeys.range(from(), to()),
		queryFn: () => dailyCalcRepository().listRange(from(), to()),
		enabled: !!from() && !!to()
	}));
