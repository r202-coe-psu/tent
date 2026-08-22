import { z } from 'zod';
import type { BaseDoc, Timestamp, AuthorContext } from '$lib/db/model';
import { makeDoc } from '$lib/db/model';
import {
	parseQty,
	persistQty,
	addQty,
	qtyGte,
	qtyLte,
	qtyStrCoerceSignedNonZeroSchema,
	type QtyValue
} from '$lib/utils/qty';

// ---- GasLedgerEntry (schema.md §2.7.2) — append-only -------------------
// Real per-cylinder stock for `gas_cylinder_type` (kitchen.ts) — mirrors
// operations' `stock_ledger` (signed delta, never a stored running total)
// but kept as its own doc type since gas is not an `item_master`/`supply_item`.

// 'adjust' (CR-080 addendum) — manual write-off for a dust-sized remainder that
// can never legitimately reach 0 through consumption: a gas draw is a hard
// all-or-nothing block (unlike stock_ledger's partial-issue), so a cylinder
// left with e.g. 0.001 kg stays stuck at status 'in_use' forever unless some
// future plan needs exactly ≤ that amount. 'adjust' zeroes it out explicitly.
export const gasLedgerReasonSchema = z.enum(['consumption', 'refill', 'adjust']);
export type GasLedgerReason = z.infer<typeof gasLedgerReasonSchema>;

export interface GasLedgerEntry extends BaseDoc {
	type: 'gas_ledger';
	cylinder_id: string;
	qty_kg: string; // qty_str signed, never 0 — negative = consumption, positive = refill
	reason: GasLedgerReason;
	ref_id: string | null; // meal_plan_id when reason = 'consumption'
	occurred_at: Timestamp;
}

export const gasLedgerInputSchema = z.object({
	cylinder_id: z.string().min(1),
	qty_kg: qtyStrCoerceSignedNonZeroSchema,
	reason: gasLedgerReasonSchema,
	ref_id: z.string().nullable().default(null)
});
export type GasLedgerInput = z.input<typeof gasLedgerInputSchema>;

export function createGasLedgerEntry(input: GasLedgerInput, ctx: AuthorContext): GasLedgerEntry {
	const d = gasLedgerInputSchema.parse(input);
	return makeDoc(
		'gas_ledger',
		1,
		{
			cylinder_id: d.cylinder_id,
			qty_kg: persistQty(d.qty_kg),
			reason: d.reason,
			ref_id: d.ref_id,
			occurred_at: new Date().toISOString()
		},
		ctx
	);
}

export const isGasLedgerEntry = (d: unknown): d is GasLedgerEntry =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'gas_ledger';

/**
 * Remaining gas (kg) for one cylinder — computed from `capacity_kg` + the sum
 * of every ledger entry for that cylinder. Never a stored running total
 * (CONVENTIONS.md) — a wrong entry is corrected by writing a new offsetting
 * entry, never by editing history.
 */
export function gasCylinderBalance(
	entries: readonly GasLedgerEntry[],
	cylinderId: string,
	capacityKg: QtyValue
): string {
	let remaining = persistQty(capacityKg);
	for (const e of entries) {
		if (e.cylinder_id === cylinderId) remaining = addQty(remaining, e.qty_kg);
	}
	return remaining;
}

export type GasCylinderStatus = 'unused' | 'in_use' | 'empty';

/** Derived, never stored — recomputed from the balance each time (no drift). */
export function gasCylinderStatus(remainingKg: QtyValue, capacityKg: QtyValue): GasCylinderStatus {
	if (qtyLte(remainingKg, 0)) return 'empty';
	if (qtyGte(remainingKg, capacityKg)) return 'unused';
	return 'in_use';
}

/**
 * How much of a refill would actually be accepted before the tank overflows
 * past `capacity_kg`. Used to validate the "เติมแก๊ส" action — a refill amount
 * greater than this would push `remaining_kg` past what the physical tank holds.
 */
export function maxRefillKg(remainingKg: QtyValue, capacityKg: QtyValue): string {
	const room = parseQty(capacityKg).minus(parseQty(remainingKg));
	return room.isNegative() ? '0' : persistQty(room);
}
