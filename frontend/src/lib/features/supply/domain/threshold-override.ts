import { z } from 'zod';
import type { BaseDoc } from '$lib/db/model';

export const stockThresholdOverrideSchema = z.object({
    type: z.literal('stock_threshold_override'),
    schema_v: z.literal(1),
    item_id: z.string().min(1, 'ต้องระบุ SKU สินค้า'),
    reorder_level: z.coerce.number().nonnegative().nullable().default(null),
    target_reserve_days:
        z.coerce.number().positive().nullable().default(null),
    consumption_rate: z.string().trim().nullable().default(null)
});

export type StockThresholdOverride = BaseDoc & z.infer<typeof stockThresholdOverrideSchema>;

export const isStockThresholdOverride = (d: unknown): d is StockThresholdOverride =>
    !!d && typeof d === 'object' && (d as { type?: unknown }).type === 'stock_threshold_override';