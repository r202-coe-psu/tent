/**
 * Decimal quantity math for stock / donation / resource amounts (CR-038).
 *
 * Persist transactional qty as `qty_str` (JSON string, ≤4 fractional digits).
 * Always compute through this module — never `+`/`*`/`Math.*` on qty, and prefer
 * constructing from strings (`new Decimal('0.1')`) so IEEE-754 noise never enters.
 */

import Decimal from 'decimal.js';
import { z } from 'zod';

/** Fractional digits kept for quantity arithmetic and persistence. */
export const QTY_DECIMALS = 4;

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type QtyValue = Decimal.Value;

const QTY_STR_RE = /^-?\d+(\.\d{1,4})?$/;

/** Parse any Decimal-accepted value into a Decimal instance. Prefer strings. */
export function parseQty(value: QtyValue): Decimal {
	return new Decimal(value);
}

/**
 * Legacy read-side helper: a finite number becomes its exact decimal string (no rounding,
 * no exponent); strings and anything else pass through unchanged.
 */
export function toQtyStrLossless(value: unknown): unknown {
	if (typeof value !== 'number' || !Number.isFinite(value)) return value;
	return parseQty(value).toFixed();
}

/**
 * Canonical persist form for CouchDB `qty_str` fields.
 * Rounds to {@link QTY_DECIMALS} then emits a compact string (no trailing zeros padding).
 */
export function persistQty(value: QtyValue): string {
	return parseQty(value).toDecimalPlaces(QTY_DECIMALS, Decimal.ROUND_HALF_UP).toString();
}

/**
 * Strict parse of text a user typed into a quantity box (#939): plain decimal digits only (no
 * sign, exponent or separators) with at most {@link QTY_DECIMALS} significant fractional digits
 * (`0.30000` is fine, `0.12345` is not). Returns the persist string, or null when invalid.
 * Never routes through `Number()`, so `1e21` and float noise cannot reach storage.
 * For the looser variant (accepts `.5` / `5.`), see {@link parseQtyInput}.
 */
export function parseQtyInputStrict(raw: string): string | null {
	const text = raw.trim();
	if (!/^\d+(\.\d+)?$/.test(text)) return null;
	const value = new Decimal(text);
	if (value.decimalPlaces() > QTY_DECIMALS) return null;
	// toFixed(): `toString()` switches to exponent notation from 1e21 (`'1e+21'`), which must not reach storage.
	return value.toFixed();
}

/** Round to qty scale and return persist string. */
export function roundQty(value: QtyValue): string {
	return persistQty(value);
}

/**
 * Round and return a JS number — only for out-of-scope SOP / daily_calc paths that
 * still persist IEEE numbers. Prefer {@link persistQty} for transactional qty.
 */
export function roundQtyNumber(value: QtyValue): number {
	return parseQty(value).toDecimalPlaces(QTY_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
}

/** Display form with thousands separators ("12,500.5"), keeping up to {@link QTY_DECIMALS} decimals. */
export function formatQty(value: QtyValue): string {
	return new Intl.NumberFormat('th-TH', { maximumFractionDigits: QTY_DECIMALS }).format(
		Number(persistQty(value))
	);
}

/** `a + b`, then persist. */
export function addQty(a: QtyValue, b: QtyValue): string {
	return persistQty(parseQty(a).plus(b));
}

/** `a - b`, then persist. */
export function subQty(a: QtyValue, b: QtyValue): string {
	return persistQty(parseQty(a).minus(b));
}

/** Absolute value as persist string. */
export function qtyAbs(value: QtyValue): string {
	return persistQty(parseQty(value).abs());
}

/** Negate (e.g. outbound ledger delta). */
export function qtyNeg(value: QtyValue): string {
	return persistQty(parseQty(value).negated());
}

/** True when rounded `a` is greater than rounded `b`. */
export function qtyGt(a: QtyValue, b: QtyValue): boolean {
	return parseQty(roundQty(a)).gt(roundQty(b));
}

/** True when rounded `a` is greater than or equal to rounded `b`. */
export function qtyGte(a: QtyValue, b: QtyValue): boolean {
	return parseQty(roundQty(a)).gte(roundQty(b));
}

/** True when rounded `a` is less than or equal to rounded `b`. */
export function qtyLte(a: QtyValue, b: QtyValue): boolean {
	return parseQty(roundQty(a)).lte(roundQty(b));
}

/** True when value is zero after qty rounding. */
export function qtyIsZero(value: QtyValue): boolean {
	return parseQty(roundQty(value)).isZero();
}

const QTY_INPUT_RE = /^-?(\d{1,15}(\.\d{0,4})?|\.\d{1,4})$/;

/**
 * Parse what a person typed into a qty field: the canonical qty string, or null when it is not
 * a plain decimal with ≤4 fractional digits. Accepts `.5` and `5.`, which a number input allows;
 * rejects exponents, which it also allows but CR-038 does not. The integer part stops at 15
 * digits: past that, decimal.js prints exponent notation and rounds at its 20-digit precision.
 * For plain digits only (no `.5` / `5.` / sign), use {@link parseQtyInputStrict}.
 */
export function parseQtyInput(raw: string): string | null {
	const trimmed = raw.trim();
	return QTY_INPUT_RE.test(trimmed) ? persistQty(trimmed) : null;
}

/** Zod: transactional qty string (allows zero; signed). */
export const qtyStrSchema = z
	.string()
	.regex(QTY_STR_RE, 'Quantity must be a decimal string with ≤4 fractional digits')
	.transform((s) => persistQty(s));

/** Zod: positive qty string (≠ 0 and > 0). */
export const qtyStrPositiveSchema = qtyStrSchema.refine((s) => qtyGt(s, 0), {
	message: 'Quantity must be greater than 0'
});

/** Zod: non-negative qty string (≥ 0). */
export const qtyStrNonNegativeSchema = qtyStrSchema.refine((s) => qtyGte(s, 0), {
	message: 'Quantity must be ≥ 0'
});

/** Zod: signed nonzero qty (ledger deltas). */
export const qtyStrSignedNonZeroSchema = qtyStrSchema.refine((s) => !qtyIsZero(s), {
	message: 'Quantity cannot be zero'
});

/**
 * Accept string | number from forms/legacy, coerce to persist qty_str.
 * Prefer raw strings from UI; numbers are accepted only at boundaries.
 */
export const qtyStrCoerceSchema = z.union([z.string(), z.number()]).transform((v, ctx) => {
	try {
		const raw = typeof v === 'number' ? String(v) : v.trim();
		const out = persistQty(raw);
		if (!QTY_STR_RE.test(out)) {
			ctx.addIssue({ code: 'custom', message: 'Invalid quantity' });
			return z.NEVER;
		}
		return out;
	} catch {
		ctx.addIssue({ code: 'custom', message: 'Invalid quantity' });
		return z.NEVER;
	}
});

export const qtyStrCoercePositiveSchema = qtyStrCoerceSchema.refine((s) => qtyGt(s, 0), {
	message: 'Quantity must be greater than 0'
});

export const qtyStrCoerceNonNegativeSchema = qtyStrCoerceSchema.refine((s) => qtyGte(s, 0), {
	message: 'Quantity must be ≥ 0'
});

export const qtyStrCoerceSignedNonZeroSchema = qtyStrCoerceSchema.refine((s) => !qtyIsZero(s), {
	message: 'Quantity cannot be zero'
});
