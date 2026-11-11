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

export class InvalidRatioQtyError extends Error {
	constructor(id: string, field: string) {
		super(`ข้อมูล ${id} ช่อง ${field} อ่านค่าไม่ได้`);
	}
}

export function readRatioQty(
	id: string,
	field: string,
	value: unknown,
	schema: { safeParse: (value: unknown) => { success: boolean; data?: string } }
): string {
	if (
		(typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) &&
		(typeof value !== 'number' || !Number.isFinite(value))
	) {
		throw new InvalidRatioQtyError(id, field);
	}
	const result = schema.safeParse(value);
	if (!result.success || result.data === undefined) throw new InvalidRatioQtyError(id, field);
	return result.data;
}
