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

export const THAILAND_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The project convention defines operational calendar days in Thailand (UTC+7) as YYYY-MM-DD. */
export function thailandCalendarDay(isoTimestampOrDate: string | Date = new Date()): string {
	const d =
		typeof isoTimestampOrDate === 'string' ? new Date(isoTimestampOrDate) : isoTimestampOrDate;
	return new Date(d.getTime() + THAILAND_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

export interface WholeItemValidationResult {
	isValid: boolean;
	value?: string;
	normalized: string | null;
	error?: string;
}

export interface WholeItemValidationOptions {
	allowZero?: boolean;
}

const WHOLE_NUMBER_STRING_RE = /^0*\d+$/;
const POSITIVE_WHOLE_NUMBER_RE = /^0*[1-9]\d*$/;

export const positiveWholeQtySchema = z
	.string()
	.trim()
	.regex(POSITIVE_WHOLE_NUMBER_RE, 'Quantity must be a positive whole number')
	.transform((value) => value.replace(/^0+/, ''));

export const nonNegativeWholeQtySchema = z
	.string()
	.trim()
	.regex(WHOLE_NUMBER_STRING_RE, 'Quantity must be a non-negative whole number')
	.transform((value) => value.replace(/^0+/, '') || '0');

export const positiveWholeQtyCoerceSchema = z
	.union([z.string(), z.number()])
	.transform((value, ctx) => {
		const parsed = positiveWholeQtySchema.safeParse(String(value));
		if (!parsed.success) {
			ctx.addIssue({ code: 'custom', message: 'Quantity must be a positive whole number' });
			return z.NEVER;
		}
		return parsed.data;
	});

export const nonNegativeWholeQtyCoerceSchema = z
	.union([z.string(), z.number()])
	.transform((value, ctx) => {
		const parsed = nonNegativeWholeQtySchema.safeParse(String(value));
		if (!parsed.success) {
			ctx.addIssue({ code: 'custom', message: 'Quantity must be a non-negative whole number' });
			return z.NEVER;
		}
		return parsed.data;
	});

/**
 * Validates a count quantity without rounding or floating-point conversion.
 * Leading zeroes are canonicalized textually; decimal/scientific notation is rejected.
 */
export function validateWholeItemInput(
	raw: string,
	options?: WholeItemValidationOptions
): WholeItemValidationResult {
	const trimmed = (raw ?? '').trim();
	if (!trimmed) {
		return { isValid: false, normalized: null, error: 'กรุณาระบุจำนวน' };
	}

	if (!WHOLE_NUMBER_STRING_RE.test(trimmed)) {
		if (/^-/.test(trimmed)) {
			return {
				isValid: false,
				normalized: null,
				error: options?.allowZero ? 'จำนวนต้องไม่ติดลบ (≥ 0)' : 'จำนวนต้องมากกว่า 0'
			};
		}
		return {
			isValid: false,
			normalized: null,
			error: /\./.test(trimmed)
				? options?.allowZero
					? 'จำนวนต้องเป็นจำนวนเต็ม เช่น 0, 1, 2, 3'
					: 'จำนวนต้องเป็นจำนวนเต็ม เช่น 1, 2, 3'
				: 'จำนวนต้องเป็นตัวเลขจำนวนเต็มที่ถูกต้อง'
		};
	}

	const value = trimmed.replace(/^0+/, '') || '0';
	if (value === '0' && !options?.allowZero) {
		return {
			isValid: false,
			normalized: null,
			error: 'จำนวนต้องมากกว่า 0'
		};
	}
	return {
		isValid: true,
		value,
		normalized: value
	};
}
