import { z } from 'zod';
import type { MealService } from './kitchen';
import { addQty, qtyStrCoercePositiveSchema } from '$lib/utils/qty';

/**
 * Warehouse receipt of cooked food: the yield of one `meal_service` is split
 * into one or more lines, each naming a ready-meal `item_master`, a quantity
 * and (optionally) a shelter storage point. Confirming writes one
 * `stock_ledger` row per merged line (`reason: 'receive'`,
 * `ref_id: meal_service._id`) next to the `meal_service_receipt`.
 */

/** Cooked food must be stored/served within this window (ready_meal rule). */
export const KITCHEN_YIELD_SHELF_LIFE_HOURS = 4;

export const yieldReceiptLineSchema = z.object({
	item_id: z.string().min(1, 'เลือกรายการอาหาร'),
	qty: qtyStrCoercePositiveSchema,
	storage_point: z.object({ id: z.string().min(1), name: z.string().min(1) }).nullish()
});
export type YieldReceiptLineInput = z.input<typeof yieldReceiptLineSchema>;
export type YieldReceiptLine = z.output<typeof yieldReceiptLineSchema>;

export const yieldReceiptInputSchema = z.object({
	lines: z.array(yieldReceiptLineSchema).min(1, 'ต้องมีอย่างน้อย 1 รายการ')
});
export type YieldReceiptInput = z.input<typeof yieldReceiptInputSchema>;

/**
 * A line after the application layer has looked its item up in the catalog:
 * `unit` is the item's base unit (the ledger refuses any other) and
 * `item_name` is snapshotted into `lot.note` for the stock screens.
 */
export type ResolvedYieldLine = YieldReceiptLine & { unit: string; item_name: string };

/**
 * Collapse lines that name the same item at the same storage point into one,
 * summing their quantity. Lines for the same item at different points stay
 * separate (they are different physical lots), but the ledger id is derived
 * from item + point so each combination maps to exactly one row.
 */
export function mergeYieldLines<T extends YieldReceiptLine>(lines: readonly T[]): T[] {
	const merged = new Map<string, T>();
	for (const line of lines) {
		const key = yieldLineKey(line);
		const existing = merged.get(key);
		merged.set(key, existing ? { ...existing, qty: addQty(existing.qty, line.qty) } : line);
	}
	return [...merged.values()];
}

/** Stable key of one ledger row inside a receipt: item + storage point. */
export function yieldLineKey(line: Pick<YieldReceiptLine, 'item_id' | 'storage_point'>): string {
	return `${line.item_id}|${line.storage_point?.id ?? ''}`;
}

/** Sum of every line's quantity (for comparing against `actual_yield`). */
export function yieldTotal(lines: readonly Pick<YieldReceiptLine, 'qty'>[]): string {
	return lines.reduce((sum, line) => addQty(sum, line.qty), '0');
}

/** Cooked food expires {@link KITCHEN_YIELD_SHELF_LIFE_HOURS}h after the service was recorded. */
export function kitchenYieldExpiry(service: Pick<MealService, 'created_at'>): string {
	const base = new Date(service.created_at).getTime();
	return new Date(base + KITCHEN_YIELD_SHELF_LIFE_HOURS * 60 * 60 * 1000).toISOString();
}

/** One editable row of the receive-stock form (everything still a string). */
export interface YieldDraftLine {
	/** Stable key for `{#each}` — rows are added/removed, so the index is no identity. */
	key: string;
	item_id: string;
	qty: string;
	/** Storage point id; '' = unspecified (main store). */
	storage_point_id: string;
}

/** Form rows → the input the confirm mutation validates, resolving point ids to `{id, name}`. */
export function toYieldReceiptInput(
	draft: readonly YieldDraftLine[],
	points: readonly { id: string; name: string }[]
): YieldReceiptInput {
	return {
		lines: draft.map((row) => {
			const point = row.storage_point_id
				? (points.find((p) => p.id === row.storage_point_id) ?? null)
				: null;
			return { item_id: row.item_id, qty: row.qty, storage_point: point };
		})
	};
}
