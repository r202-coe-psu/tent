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

export interface WholeItemNormalizationResult {
	isValid: boolean;
	value?: string;
	normalized: string | null;
	wasNormalized?: boolean;
	error?: string;
}

export interface WholeItemNormalizationOptions {
	allowZero?: boolean;
}

const POSITIVE_DECIMAL_STRING_RE = /^0*(\d+)(?:\.(\d+))?$/;

/**
 * Normalizes user-entered whole-item quantities by ALWAYS ROUNDING UP (Ceiling).
 * Operates purely on decimal-string semantics with ZERO IEEE-754 floating-point conversion.
 *
 * Examples:
 * - "1"      -> "1"
 * - "01"     -> "1"
 * - "1.0"    -> "1"
 * - "2.000"  -> "2"
 * - "0.1"    -> "1"
 * - "0.5"    -> "1"
 * - "1.01"   -> "2"
 * - "1.5"    -> "2"
 * - "1.99"   -> "2"
 * - "2.0001" -> "3"
 * - "10.01"  -> "11"
 *
 * Invalid inputs remain invalid:
 * - "", "0" (when allowZero is false), negative numbers ("-1", "-0.5"),
 *   non-numeric ("abc", "NaN", "Infinity"), and scientific notation ("1e2", "1E2").
 */
export function normalizeWholeItemInput(
	raw: string,
	options?: WholeItemNormalizationOptions
): WholeItemNormalizationResult {
	const trimmed = (raw ?? '').trim();
	if (!trimmed) {
		return { isValid: false, normalized: null, error: 'กรุณาระบุจำนวน' };
	}

	const match = POSITIVE_DECIMAL_STRING_RE.exec(trimmed);
	if (!match) {
		return {
			isValid: false,
			normalized: null,
			error: 'จำนวนต้องเป็นตัวเลขที่ถูกต้อง'
		};
	}

	const intPart = match[1];
	const fracPart = match[2];
	const intClean = intPart.replace(/^0+/, '') || '0';
	const hasFraction = fracPart !== undefined && /[1-9]/.test(fracPart);

	if (intClean === '0' && !hasFraction) {
		if (options?.allowZero) {
			return {
				isValid: true,
				value: '0',
				normalized: '0',
				wasNormalized: trimmed !== '0'
			};
		}
		return {
			isValid: false,
			normalized: null,
			error: 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป'
		};
	}

	let result: string;
	if (hasFraction) {
		result = (BigInt(intClean) + 1n).toString();
	} else {
		result = intClean;
	}

	return {
		isValid: true,
		value: result,
		normalized: result,
		wasNormalized: result !== trimmed
	};
}
