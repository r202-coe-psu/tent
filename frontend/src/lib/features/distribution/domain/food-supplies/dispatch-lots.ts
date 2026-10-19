import { addQty, parseQty, qtyGt, qtyLte } from '$lib/utils/qty';

/** One slice of a ticket item's dispatch: take `qty` out of the physical lot `lot_ref`. */
export type DispatchLotAllocation = { lot_ref: string; qty: string };

/** A physical lot the dispatcher may draw from, as seen at dispatch time. */
export type DispatchLotCandidate = {
	lot_ref: string;
	/** Remaining balance of the lot. */
	qty: string;
	expired: boolean;
};

export type DispatchLotFailureReason =
	| 'no_lots'
	| 'invalid_lot_ref'
	| 'duplicate_lot'
	| 'non_positive_qty'
	| 'unknown_lot'
	| 'expired_lot'
	| 'exceeds_lot_balance'
	| 'sum_mismatch';

export type DispatchLotValidation =
	| { ok: true; total: string }
	| { ok: false; reason: DispatchLotFailureReason; lot_ref?: string; total: string };

const LOT_REF_PATTERN = /^stock_ledger:.+/;

function isPositiveQty(value: string): boolean {
	try {
		return qtyGt(value, 0);
	} catch {
		return false;
	}
}

/** Sum of the well-formed (positive) allocation quantities; malformed entries count as 0. */
export function sumDispatchAllocations(allocations: readonly DispatchLotAllocation[]): string {
	return allocations.reduce(
		(sum, allocation) => (isPositiveQty(allocation.qty) ? addQty(sum, allocation.qty) : sum),
		'0'
	);
}

/**
 * Validates how one ticket item is split across physical lots (#655): at least one lot, each
 * lot used once with a positive qty, never expired, never above its remaining balance, and the
 * total exactly equal to `allocatedQty`.
 */
export function validateDispatchLotAllocations(
	allocatedQty: string,
	allocations: readonly DispatchLotAllocation[],
	candidates: readonly DispatchLotCandidate[]
): DispatchLotValidation {
	const total = sumDispatchAllocations(allocations);
	const fail = (reason: DispatchLotFailureReason, lot_ref?: string): DispatchLotValidation => ({
		ok: false,
		reason,
		...(lot_ref ? { lot_ref } : {}),
		total
	});

	if (allocations.length === 0) return fail('no_lots');

	const byRef = new Map(candidates.map((candidate) => [candidate.lot_ref, candidate]));
	const seen = new Set<string>();
	for (const allocation of allocations) {
		const { lot_ref, qty } = allocation;
		if (typeof lot_ref !== 'string' || !LOT_REF_PATTERN.test(lot_ref)) {
			return fail('invalid_lot_ref', lot_ref);
		}
		if (seen.has(lot_ref)) return fail('duplicate_lot', lot_ref);
		seen.add(lot_ref);
		if (!isPositiveQty(qty)) return fail('non_positive_qty', lot_ref);
		const candidate = byRef.get(lot_ref);
		if (!candidate) return fail('unknown_lot', lot_ref);
		if (candidate.expired) return fail('expired_lot', lot_ref);
		if (!qtyLte(qty, candidate.qty)) return fail('exceeds_lot_balance', lot_ref);
	}

	if (!parseQty(total).eq(parseQty(allocatedQty))) return fail('sum_mismatch');
	return { ok: true, total };
}
