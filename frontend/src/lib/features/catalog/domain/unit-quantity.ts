import { parseQty, type QtyValue } from '$lib/utils/qty';
import {
	canonicalizeUnitCode,
	FALLBACK_UNIT_DEFINITIONS,
	type Dimension,
	type UnitOfMeasure
} from './unit-of-measure';

export const WHOLE_QTY_MESSAGE = 'หน่วยนับต้องเป็นจำนวนเต็ม';

export type UnitDimensionSource = readonly Pick<UnitOfMeasure, 'code' | 'dimension'>[];

function dimensionByCode(code: string, units?: UnitDimensionSource): Dimension | undefined {
	const normalized = code.trim().toLowerCase();
	const matched = units?.find((u) => u.code.trim().toLowerCase() === normalized);
	if (matched) return matched.dimension;
	return FALLBACK_UNIT_DEFINITIONS.find((u) => u.code === normalized)?.dimension;
}

/**
 * Dimension of a unit code or legacy label. The UOM master wins over the built-in
 * fallback list; `undefined` means the unit is unknown and no rule is enforced.
 */
export function resolveUnitDimension(
	unit: string | null | undefined,
	units?: UnitDimensionSource
): Dimension | undefined {
	if (typeof unit !== 'string' || !unit.trim()) return undefined;
	const direct = dimensionByCode(unit, units);
	if (direct) return direct;
	const code = canonicalizeUnitCode(unit);
	return code ? dimensionByCode(code, units) : undefined;
}

export const requiresWholeQty = (dimension: Dimension | undefined): boolean =>
	dimension === 'count';

export const qtyInputStep = (dimension: Dimension | undefined): '1' | 'any' =>
	requiresWholeQty(dimension) ? '1' : 'any';

/** Empty or unparseable input returns `undefined`; other validators own those cases. */
export function wholeQtyError(
	qty: QtyValue | '' | null | undefined,
	dimension: Dimension | undefined
): string | undefined {
	if (!requiresWholeQty(dimension) || qty === '' || qty == null) return undefined;
	try {
		const value = parseQty(typeof qty === 'string' ? qty.trim() : qty);
		return value.isFinite() && !value.isInteger() ? WHOLE_QTY_MESSAGE : undefined;
	} catch {
		return undefined;
	}
}

/** For system-computed quantities, which round up to a whole number for every unit. */
export const roundUpQty = (qty: QtyValue): number => parseQty(qty).ceil().toNumber();
