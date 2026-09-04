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

// ---- GasLedgerEntry (append-only ledger of gas consumption, refills, and adjustments) ----

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
 * Computes remaining gas (kg) for a cylinder: capacity_kg + sum of ledger deltas.
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

/** Determines cylinder status ('unused' | 'in_use' | 'empty') based on balance. */
export function gasCylinderStatus(remainingKg: QtyValue, capacityKg: QtyValue): GasCylinderStatus {
	if (qtyLte(remainingKg, 0)) return 'empty';
	if (qtyGte(remainingKg, capacityKg)) return 'unused';
	return 'in_use';
}

/**
 * Computes maximum refill quantity (kg) before reaching tank capacity.
 */
export function maxRefillKg(remainingKg: QtyValue, capacityKg: QtyValue): string {
	const room = parseQty(capacityKg).minus(parseQty(remainingKg));
	return room.isNegative() ? '0' : persistQty(room);
}
