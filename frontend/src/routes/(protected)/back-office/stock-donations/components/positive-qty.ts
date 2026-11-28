import { qtyGt } from '$lib/utils/qty';

/**
 * `qtyGt(value, 0)` for text a person typed. `qtyGt` throws on anything decimal.js cannot
 * parse (`abc`, `1e`), which inside a validator would surface as an exception instead of the
 * field's message — so unparseable text is simply "not positive" here.
 */
export function isPositiveQty(value: string): boolean {
	try {
		return qtyGt(value, 0);
	} catch {
		return false;
	}
}
