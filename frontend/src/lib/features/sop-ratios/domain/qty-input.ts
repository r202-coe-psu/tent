import { parseQty, qtyGt } from '$lib/utils/qty';

/** True when the form input is a finite decimal that is still > 0 after rounding to 4 dp. */
export function isPositiveQty(value: string | number | undefined): boolean {
	try {
		const d = parseQty(value ?? '');
		return d.isFinite() && qtyGt(d, 0);
	} catch {
		return false;
	}
}
