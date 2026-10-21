import { qtyAbs, qtyGt, qtyIsZero, subQty } from '$lib/utils/qty';

/** The quantities one intake line compares: what the donor declared and what staff count. */
export type ReceiveLineQty = {
	declaredQty: string;
	/**
	 * The donor's unit as a canonical `unit_of_measure.code`, or `null` when it does not
	 * resolve to one (a free-text label such as "ลัง" that no unit matches).
	 */
	declaredUnit: string | null;
	qty: string;
	/** The unit staff count in: the picked stock item's `base_unit` (#623). */
	unit: string;
};

/**
 * How far the counted quantity is from the declared one — `null` when they match, and
 * also when the two are in different units. A donor who declared "3 กล่อง" against an
 * item counted in bottles has not under-delivered by "-33 bottles"; the numbers simply
 * do not compare, so no "มากกว่า/น้อยกว่าที่แจ้ง" badge is shown (#623).
 */
export function receivedQtyDifference(
	line: ReceiveLineQty
): { more: boolean; amount: string } | null {
	if (!line.declaredUnit || line.declaredUnit !== line.unit) return null;
	try {
		const diff = subQty(line.qty, line.declaredQty);
		if (qtyIsZero(diff)) return null;
		return { more: qtyGt(diff, 0), amount: qtyAbs(diff) };
	} catch {
		return null;
	}
}
