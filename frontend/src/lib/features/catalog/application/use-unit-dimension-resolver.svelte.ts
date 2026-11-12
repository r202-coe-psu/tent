import type { Dimension } from '../domain/unit-of-measure';
import { resolveUnitDimension } from '../domain/unit-quantity';
import { useUnitsOfMeasure } from './queries';

/**
 * Resolves a unit code or legacy label to its dimension from the UOM master,
 * using the built-in definitions until the master loads.
 */
export function useUnitDimensionResolver() {
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data);
	return {
		resolve: (unit: string | null | undefined): Dimension | undefined =>
			resolveUnitDimension(unit, units)
	};
}
