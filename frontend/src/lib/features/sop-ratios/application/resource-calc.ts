/**
 * Application hooks for the resource-calc dashboard (T-32).
 * Reads the snapshot through the data provider (provisional until T-31 lands).
 */

import { createQuery } from '@tanstack/svelte-query';
import { loadResourceCalc } from '../data/resource-calc.provider';

export const resourceCalcKeys = {
	all: ['resource-calc'] as const,
	snapshot: (shelterCode: string) => [...resourceCalcKeys.all, shelterCode] as const
};

/**
 * Live snapshot for one shelter. Pass a getter so the query stays reactive to
 * the active shelter scope; it is disabled until a shelter code is known.
 */
export const useResourceCalc = (shelterCode: () => string | null | undefined) =>
	createQuery(() => {
		const code = shelterCode();
		return {
			queryKey: resourceCalcKeys.snapshot(code ?? '—'),
			queryFn: () => loadResourceCalc(code as string),
			enabled: Boolean(code)
		};
	});
