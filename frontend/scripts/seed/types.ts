import type { MasterDataItem, MasterDataType } from '$lib/features/master-data/domain';

/** One item to seed. `key` is a seed-only handle; `code` is generated/reused. */
export type SeedItemDef = {
	key: string;
	label: string;
	is_default?: boolean;
	/** `key` of the owning item in `parent_type` (community → municipality zone). */
	parent_key?: string;
};

export type MasterTypeDef = {
	type: MasterDataType;
	/** Type `parent_key` resolves against — must appear earlier in the list. */
	parent_type?: MasterDataType;
	items: SeedItemDef[];
};

/** Resolved `master_type` → seed `key` → the item as persisted. */
export type MasterLookup = Record<MasterDataType, Record<string, MasterDataItem>>;

export function masterItem(
	master: MasterLookup,
	type: MasterDataType,
	key: string
): MasterDataItem {
	const item = master[type]?.[key];
	if (!item) throw new Error(`seed: no master_data item "${key}" seeded for type "${type}"`);
	return item;
}

export const masterCode = (m: MasterLookup, type: MasterDataType, key: string) =>
	masterItem(m, type, key).code;

export const masterCodes = (m: MasterLookup, type: MasterDataType, ...keys: string[]) =>
	keys.map((key) => masterCode(m, type, key));

export const masterLabel = (m: MasterLookup, type: MasterDataType, key: string) =>
	masterItem(m, type, key).label;

export const masterLabels = (m: MasterLookup, type: MasterDataType, ...keys: string[]) =>
	keys.map((key) => masterLabel(m, type, key));

/** Catalog supply-item IDs referenced by ops seed. */
export const ITEM = {
	rice: 'item:rice',
	water: 'item:water',
	paracetamol: 'item:paracetamol',
	soap: 'item:soap',
	blanket: 'item:blanket',
	egg: 'item:egg',
	vegetable: 'item:vegetable'
} as const;

export const SH001_CODE = 'SH001';
export const SH002_CODE = 'SH002';
export const SH003_CODE = 'SH003';
export const SH004_CODE = 'SH004';

export const STAGING_VOLUME = {
	SH001: 450,
	SH002: 350,
	SH003: 200
} as const;

export const ALL_VG_KEYS = [
	'elderly_dependent',
	'disability_other',
	'wheelchair',
	'bedridden',
	'pregnant',
	'infant',
	'young_child',
	'chronic_illness',
	'dialysis',
	'psychiatric',
	'vision_impaired',
	'hearing_impaired'
] as const;
