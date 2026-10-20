import type { CardSnapshot } from '$lib/features/people/domain/people';

type WalkInAddress = Pick<
	CardSnapshot,
	'address_no' | 'village_no' | 'subdistrict' | 'district' | 'province'
>;

const ADDRESS_FIELDS = ['address_no', 'village_no', 'subdistrict', 'district', 'province'] as const;

/** A card address is only comparable when these parts are all present. */
const REQUIRED_FIELDS: ReadonlySet<(typeof ADDRESS_FIELDS)[number]> = new Set([
	'address_no',
	'subdistrict',
	'district',
	'province'
]);

const FIELD_SEPARATOR = '\u001f';

/** Leading type words a card or ThaiD may or may not write; longest first so 'หมู่ที่' beats 'หมู่'. */
const PREFIXES: Partial<Record<(typeof ADDRESS_FIELDS)[number], readonly string[]>> = {
	village_no: ['หมู่ที่', 'หมู่', 'ม.'],
	subdistrict: ['ตำบล', 'แขวง', 'ต.'],
	district: ['อำเภอ', 'เขต', 'อ.'],
	province: ['จังหวัด', 'จ.']
};

function normalizePart(field: (typeof ADDRESS_FIELDS)[number], value: string | undefined): string {
	const collapsed = (value ?? '').trim().replace(/\s+/g, ' ');
	if (collapsed === '-') return '';
	const prefix = PREFIXES[field]?.find((candidate) => collapsed.startsWith(candidate));
	const bare = prefix ? collapsed.slice(prefix.length).trim() : collapsed;
	return bare === '-' ? '' : bare;
}

/**
 * Identity of a walk-in address for putting walk-ins in one household: house number, village,
 * subdistrict, district and province, each trimmed, whitespace-collapsed, with '-' as empty and
 * the leading type word (หมู่ที่, ตำบล, อำเภอ, จังหวัด, abbreviations too) dropped so a card and a
 * ThaiD read of the same address agree. Lane, road and postal code are left out. `null` when the
 * address is too thin to trust (no house number, subdistrict, district or province).
 */
export function walkInAddressKey(snapshot: WalkInAddress): string | null {
	const parts = ADDRESS_FIELDS.map((field) => normalizePart(field, snapshot[field]));
	const incomplete = ADDRESS_FIELDS.some(
		(field, index) => REQUIRED_FIELDS.has(field) && parts[index] === ''
	);
	return incomplete ? null : parts.join(FIELD_SEPARATOR);
}

const ROAD_PREFIXES = ['ถนน', 'ถ.'] as const;

function normalizeRoad(value: string | undefined): string {
	const collapsed = (value ?? '').trim().replace(/\s+/g, ' ');
	const prefix = ROAD_PREFIXES.find((candidate) => collapsed.startsWith(candidate));
	const bare = prefix ? collapsed.slice(prefix.length).trim() : collapsed;
	return bare === '-' ? '' : bare;
}

/**
 * Whether two walk-ins' roads allow one household: a road is only compared when BOTH sides have
 * one (ThaiD gives none), after dropping '-', spacing and the ถนน / ถ. prefix. Lane is never
 * compared.
 */
export function walkInRoadsCompatible(a: string | undefined, b: string | undefined): boolean {
	const roadA = normalizeRoad(a);
	const roadB = normalizeRoad(b);
	return roadA === '' || roadB === '' || roadA === roadB;
}
