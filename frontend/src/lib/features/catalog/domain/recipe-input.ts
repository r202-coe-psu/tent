/**
 * Typing filters for the recipe (BOM) form's free-text number boxes. They keep what the user
 * typed as a clean digit string — no letters, no extra dots, no leading zeros (`007` → `7`) —
 * and never invent a value: an emptied box stays empty so validation can say so.
 */

/** Digits with at most one decimal point and no leading zeros (`00.5` → `0.5`, `00` → `0`). */
export function sanitizeQuantity(val: string): string {
	let cleaned = val.replace(/[^0-9.]/g, '');
	const parts = cleaned.split('.');
	if (parts.length > 2) {
		cleaned = parts[0] + '.' + parts.slice(1).join('');
	}
	if (/^0\d/.test(cleaned)) {
		cleaned = cleaned.replace(/^0+/, '');
		if (cleaned === '' || cleaned.startsWith('.')) cleaned = '0' + cleaned;
	}
	return cleaned;
}

/** Digits only, no leading zeros. */
export function sanitizeInteger(val: string): string {
	let cleaned = val.replace(/[^0-9]/g, '');
	if (/^0\d/.test(cleaned)) {
		cleaned = cleaned.replace(/^0+/, '');
	}
	return cleaned;
}
