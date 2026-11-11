import { qtyGt } from '$lib/utils/qty';

/**
 * Validity of numeric form inputs. A `type="number"` input binds `null` once emptied and accepts
 * typed or pasted negatives despite `min`, so the browser cannot be trusted to reject them.
 */

/**
 * True for a whole number at or above `min`, as every kitchen count schema requires
 * (`z.number().int()`); `null`, `undefined`, `NaN`, decimals and strings are not counts.
 */
export function isCount(n: number | null | undefined, min: number): boolean {
	return Number.isInteger(n) && (n as number) >= min;
}

/**
 * True for a quantity (number or numeric string, decimals allowed) still above zero once rounded
 * to the saved 4 dp, so `0.00001` fails here just as it fails the submit check.
 */
export function isPositiveQty(v: unknown): boolean {
	if ((typeof v !== 'number' && typeof v !== 'string') || v === '') return false;
	const n = Number(v);
	return Number.isFinite(n) && qtyGt(n, 0);
}

/** Inline error under a count box that is empty, negative or not a whole number. */
export const COUNT_ERROR = 'ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';

/** Why an edit to a count box is refused. */
export type EditRejection = 'negative' | 'non-numeric';

export const EDIT_REJECTION_MESSAGE: Readonly<Record<EditRejection, string>> = {
	negative: 'ไม่รับค่าติดลบ',
	'non-numeric': 'กรอกได้เฉพาะตัวเลข'
};

const UNSIGNED_DECIMAL = /^(\d+\.?\d*|\.\d+)$/;

/** Sign and exponent keys a count box never needs; shortcuts such as Ctrl+E pass. */
export function keyRejection(e: {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
}): EditRejection | null {
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	if (e.key === '-') return 'negative';
	if (e.key === '+' || e.key === 'e' || e.key === 'E') return 'non-numeric';
	return null;
}

/** Why pasted or dropped text may not enter a count box; `null` for an empty or unsigned decimal. */
export function textRejection(text: string): EditRejection | null {
	const t = text.trim();
	if (t === '') return null;
	if (t.startsWith('-')) return 'negative';
	return UNSIGNED_DECIMAL.test(t) ? null : 'non-numeric';
}
