/**
 * Housing-type Select options — CR-112 semantic codes as persisted values.
 * Master data may supply labels for known codes; never use ULID item codes as values.
 */

import { formatMasterLabel } from '$lib/features/master-data';
import type { HousingType } from './people';

export const CR112_HOUSING_TYPE_CODES = [
	'owned_house',
	'rented_house',
	'condo',
	'apartment_dorm',
	'homeless'
] as const satisfies readonly HousingType[];

export type HousingTypeSelectItem = { value: string; label: string };

export type MasterHousingItem = {
	code: string;
	label_th: string;
	label_en: string;
	status?: string;
};

/** Thai defaults matching public booking form / master seed labels. */
export const DEFAULT_HOUSING_TYPE_ITEMS_TH: HousingTypeSelectItem[] = [
	{ value: 'owned_house', label: 'บ้านตนเอง' },
	{ value: 'rented_house', label: 'บ้านเช่า' },
	{ value: 'condo', label: 'คอนโดมิเนียม' },
	{ value: 'apartment_dorm', label: 'อพาร์ตเมนต์/หอพัก' },
	{ value: 'homeless', label: 'ไร้ที่อยู่อาศัยเป็นหลักแหล่ง' }
];

/**
 * Build Select options with CR-112 codes as values.
 * - Always starts from `defaultItems` (semantic codes).
 * - Master items only overlay labels when `code` matches a default value.
 * - ULID-only / unknown master codes are ignored as option values.
 * - If `currentValue` is set but missing from the list, append an orphan option.
 */
export function buildHousingTypeSelectItems(opts: {
	defaultItems: HousingTypeSelectItem[];
	masterItems?: MasterHousingItem[];
	currentValue?: string | null;
	labelForCode?: (code: string, fallback: string) => string;
	lang?: string;
}): HousingTypeSelectItem[] {
	const { defaultItems, masterItems = [], currentValue, labelForCode, lang = 'th' } = opts;
	const knownCodes = new Set(defaultItems.map((i) => i.value));

	const masterLabelByCode = new Map<string, string>();
	for (const item of masterItems) {
		if (item.status && item.status !== 'active') continue;
		if (!knownCodes.has(item.code)) continue;
		masterLabelByCode.set(item.code, formatMasterLabel(item, lang));
	}

	const items = defaultItems.map((d) => {
		const masterLabel = masterLabelByCode.get(d.value);
		if (!masterLabel) return { value: d.value, label: d.label };
		return {
			value: d.value,
			label: labelForCode ? labelForCode(d.value, masterLabel) : masterLabel
		};
	});

	if (currentValue && !items.some((i) => i.value === currentValue)) {
		const fallback = currentValue;
		items.push({
			value: currentValue,
			label: labelForCode ? labelForCode(currentValue, fallback) : fallback
		});
	}

	return items;
}

/**
 * Select bind setter that ignores empty sync clears (bits-ui may emit ''
 * when the current value is temporarily unmatched).
 */
export function setHousingTypeFromSelect(
	next: string | undefined | null,
	set: (value: HousingType) => void
): void {
	if (next) set(next as HousingType);
}

/** Resolve a display label for a housing_type code (known CR-112 or raw fallback). */
export function housingTypeLabelForCode(
	code: string,
	items: HousingTypeSelectItem[],
	fallback = code
): string {
	return items.find((o) => o.value === code)?.label ?? fallback;
}
