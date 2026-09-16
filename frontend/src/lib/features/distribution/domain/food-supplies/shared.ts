import { z } from 'zod';

/** Shared persisted-document primitives for Food & Supplies Distribution. */
export const ULID_PATTERN = '[0-9A-HJKMNP-TV-Z]{26}';

export const requisitionTicketIdSchema = z
	.string()
	.regex(new RegExp(`^requisition_ticket:${ULID_PATTERN}$`));
export const distributionLogIdSchema = z
	.string()
	.regex(new RegExp(`^distribution_log:${ULID_PATTERN}$`));
export const bulkReturnPoolIdSchema = z
	.string()
	.regex(new RegExp(`^bulk_return_pool:${ULID_PATTERN}$`));
export const stockLedgerIdSchema = z.string().regex(new RegExp(`^stock_ledger:${ULID_PATTERN}$`));

export const foodSuppliesBaseDocShape = {
	_rev: z.string().optional(),
	schema_v: z.literal(1),
	shelter_code: z.string().min(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1)
};

export const mealPeriodSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealPeriod = z.infer<typeof mealPeriodSchema>;
