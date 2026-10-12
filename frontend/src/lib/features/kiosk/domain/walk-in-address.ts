import type { CardSnapshot } from '$lib/features/people/domain/people';

type WalkInAddress = Pick<
	CardSnapshot,
	'address_no' | 'village_no' | 'lane' | 'road' | 'subdistrict' | 'district' | 'province'
>;

const ADDRESS_FIELDS = [
	'address_no',
	'village_no',
	'lane',
	'road',
	'subdistrict',
	'district',
	'province'
] as const;

/** A card address is only comparable when these parts are all present. */
const REQUIRED_FIELDS: ReadonlySet<(typeof ADDRESS_FIELDS)[number]> = new Set([
	'address_no',
	'subdistrict',
	'district',
	'province'
]);

const FIELD_SEPARATOR = '\u001f';

function normalizePart(value: string | undefined): string {
	return (value ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Identity of a card address for putting walk-ins in one household: every address part, each
 * trimmed and whitespace-collapsed (postal code left out). `null` when the address is too thin
 * to trust (no house number, subdistrict, district or province).
 */
export function walkInAddressKey(snapshot: WalkInAddress): string | null {
	const parts = ADDRESS_FIELDS.map((field) => normalizePart(snapshot[field]));
	const incomplete = ADDRESS_FIELDS.some(
		(field, index) => REQUIRED_FIELDS.has(field) && parts[index] === ''
	);
	return incomplete ? null : parts.join(FIELD_SEPARATOR);
}
