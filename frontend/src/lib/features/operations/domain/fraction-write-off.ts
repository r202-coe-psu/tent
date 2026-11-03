import { requiresWholeQty, type Dimension } from '$lib/features/catalog';
import { parseQty, persistQty, qtyNeg, type QtyValue } from '$lib/utils/qty';
import { lotLocationFields } from './lot-storage';
import type { AdjustInput, StockLotBalance } from './operations';

export const FRACTION_WRITE_OFF_NOTE = 'ตัดเศษเหลือทิ้ง';

/**
 * The negative adjust that clears the fractional part left in a count-unit lot (#805), e.g.
 * 3.5 → '-0.5'. `undefined` when the unit is not a count unit or the balance is whole or not positive.
 */
export function fractionWriteOffQty(
	balance: QtyValue,
	dimension: Dimension | undefined
): string | undefined {
	if (!requiresWholeQty(dimension)) return undefined;
	const value = parseQty(persistQty(balance));
	if (!value.isFinite() || !value.gt(0) || value.isInteger()) return undefined;
	return qtyNeg(value.minus(value.floor()));
}

/** The adjust that writes the fraction off the lot it sits in, bound to that lot like a manual write-off. */
export function fractionWriteOffInput(
	lot: StockLotBalance,
	dimension: Dimension | undefined
): AdjustInput | undefined {
	const qty = fractionWriteOffQty(lot.qty, dimension);
	if (qty === undefined) return undefined;
	return {
		item_id: lot.item_id,
		qty,
		unit: lot.unit,
		adjust_reason: 'count_mismatch',
		note: FRACTION_WRITE_OFF_NOTE,
		lot: { ...lotLocationFields(lot.lot), expiry: lot.lot?.expiry || undefined },
		lot_ref: lot.lot_ref,
		ref_id: null
	};
}
