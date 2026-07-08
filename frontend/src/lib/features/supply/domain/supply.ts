import { z } from 'zod';
import type { BaseDoc } from '$lib/db/model';

/**
 * Supply domain — catalog items available for stock operations (schema.md §4.1).
 *
 * Supply items live in the central `catalog` database and are pulled down to
 * each device. The `_id` format is `item:{ulid}` (NOT `supply_item:{ulid}`),
 * but the `type` discriminator field is `'supply_item'`.
 *
 * This module is a minimal T-10 stub: just enough to let T-11 (stock receive)
 * pick items from the catalog and lock the unit per item.
 * NOTE (CR-013): This is an intentional transition stub. In the future, this should
 * align with the full `item_master` spec documented in CR-013.
 */

// ---------------------------------------------------------------- enums

export const supplyCategorySchema = z.enum([
	'food',
	'water',
	'medicine',
	'clothing',
	'hygiene',
	'bedding',
	'equipment',
	'other'
]);
export type SupplyCategory = z.infer<typeof supplyCategorySchema>;

/** Human-readable Thai labels for UI dropdowns and display. */
export const SUPPLY_CATEGORY_LABELS: Record<SupplyCategory, string> = {
	food: 'อาหาร',
	water: 'น้ำ',
	medicine: 'ยารักษาโรค',
	clothing: 'เสื้อผ้า',
	hygiene: 'ของใช้สุขอนามัย',
	bedding: 'เครื่องนอน',
	equipment: 'อุปกรณ์',
	other: 'อื่น ๆ'
};

// ---------------------------------------------------------------- document

/**
 * A supply item in the catalog — read-only from the shelter's perspective.
 *
 * `_id` = `item:{ulid}` (note: prefix is `item`, not `supply_item`).
 * Referenced by `stock_ledger.item_id`, `donation_item.item_id`, etc.
 */
export interface SupplyItem extends BaseDoc {
	type: 'supply_item';
	name: string;
	category: SupplyCategory;
	unit: string; // fixed unit per item — all ledger entries must use this
	reorder_level: number | null;
	perishable: boolean; // true → lot.expiry is mandatory on receive
}

// ---------------------------------------------------------------- schema

export const supplyItemSchema = z.object({
	name: z.string().trim().min(1, 'Item name is required'),
	category: supplyCategorySchema,
	unit: z.string().trim().min(1, 'Unit is required'),
	reorder_level: z.coerce.number().positive().nullable().default(null),
	perishable: z.boolean().default(false)
});
export type SupplyItemInput = z.input<typeof supplyItemSchema>;

// ---------------------------------------------------------------- type guard

/**
 * Runtime type guard for SupplyItem documents.
 *
 * Note: `allByType('item', isSupplyItem)` — the prefix scan uses `'item'`
 * (matching the `_id` prefix `item:{ulid}`), and this guard further checks
 * that the `type` field is `'supply_item'`.
 */
export const isSupplyItem = (d: unknown): d is SupplyItem =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'supply_item';
