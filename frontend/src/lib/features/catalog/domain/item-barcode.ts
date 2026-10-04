import type { UomConversion } from './catalog';

type BarcodeConversion = Pick<UomConversion, 'uom_name' | 'barcode'>;

/** Anything that carries packaging rows with optional barcodes (item master, stock form item). */
export type BarcodeSource = {
	_id: string;
	conversions?: readonly BarcodeConversion[];
};

/** Digits-only retail codes (EAN-8/13, UPC-A/E, ITF-14) as a scanner or keyboard wedge types them. */
const RETAIL_BARCODE = /^\d{8,14}$/;

/** Trim and lowercase so a scanner's trailing newline or a typed `abc-1` still matches. */
export function normalizeBarcode(code: string | undefined | null): string {
	return (code ?? '').trim().toLowerCase();
}

/** True when a search string looks like a scanned retail barcode rather than a name. */
export function looksLikeBarcode(query: string): boolean {
	return RETAIL_BARCODE.test(query.trim());
}

export type BarcodeMatch<T extends BarcodeSource> = {
	item: T;
	/** The unit the scanned code identifies (a pack, or the base unit for a base-unit row). */
	uom: string;
};

/** First item with a packaging row whose barcode equals `code`. */
export function findItemByBarcode<T extends BarcodeSource>(
	items: readonly T[],
	code: string
): BarcodeMatch<T> | null {
	const needle = normalizeBarcode(code);
	if (!needle) return null;
	for (const item of items) {
		const row = item.conversions?.find((c) => normalizeBarcode(c.barcode) === needle);
		if (row) return { item, uom: row.uom_name };
	}
	return null;
}

/** All barcodes on an item, in packaging-row order. */
export function itemBarcodes(item: { conversions?: readonly BarcodeConversion[] }): string[] {
	return (item.conversions ?? [])
		.map((c) => (c.barcode ?? '').trim())
		.filter((code) => code !== '');
}

/** Another item that already uses `code`, for the duplicate warning. */
export function barcodeOwner<T extends BarcodeSource>(
	items: readonly T[],
	code: string,
	exceptId?: string
): T | null {
	return (
		findItemByBarcode(
			items.filter((i) => i._id !== exceptId),
			code
		)?.item ?? null
	);
}

// ---------------------------------------------------------------- base-unit barcode
//
// The schema only stores a barcode on a `conversions[]` row, and a retail item's
// own code (one carton of milk) belongs to the base unit, which has no row. It is
// kept as a row for the base unit with multiplier 1. `itemSelectableUoms` already
// skips a row that repeats the base unit, so stock math is unaffected.

const sameUnit = (a: string | undefined, b: string | undefined) =>
	(a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** True for the row that holds the base unit's barcode. */
export function isBaseUnitRow(row: Pick<UomConversion, 'uom_name'>, baseUnit: string): boolean {
	return !!baseUnit.trim() && sameUnit(row.uom_name, baseUnit);
}

/** Separate the base-unit barcode row from the real packaging rows (form edit state). */
export function splitBaseBarcode<T extends BarcodeConversion>(
	conversions: readonly T[],
	baseUnit: string
): { packRows: T[]; baseBarcode: string } {
	const packRows: T[] = [];
	let baseBarcode = '';
	for (const row of conversions) {
		if (isBaseUnitRow(row, baseUnit)) baseBarcode ||= (row.barcode ?? '').trim();
		else packRows.push(row);
	}
	return { packRows, baseBarcode };
}

/** Inverse of {@link splitBaseBarcode}: append the base-unit row when a barcode is set. */
export function mergeBaseBarcode(
	packRows: readonly UomConversion[],
	baseUnit: string,
	baseBarcode: string
): UomConversion[] {
	const code = baseBarcode.trim();
	if (!code || !baseUnit.trim()) return [...packRows];
	return [...packRows, { uom_name: baseUnit, multiplier: '1', barcode: code }];
}
