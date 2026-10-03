import type { MasterDataItem, MasterDataType } from '$lib/features/master-data/domain';

/** One item to seed. `key` is the persisted `code` (semantic snake_case). */
export type SeedItemDef = {
	key: string;
	label_th: string;
	label_en: string;
	is_default?: boolean;
	/** Optional parent key — unused after CR-137 (community master removed). */
	parent_key?: string;
	category?: 'operational' | 'controlled' | 'GENERAL' | 'CONTROLLED';
	description?: string;
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
	masterItem(m, type, key).label_th;

export const masterLabels = (m: MasterLookup, type: MasterDataType, ...keys: string[]) =>
	keys.map((key) => masterLabel(m, type, key));

/**
 * Catalog items the ops seed stocks and asks for, by `item_master.name`.
 *
 * Names, not ids: the master seed mints `item_master:<ulid>` and keeps an existing doc's
 * id by matching its name (`master-seed.ts`), so the name is the stable key. The ops seed
 * resolves these to ids at run time (`staging-ops.ts`). The legacy `item:*` ids it used
 * to hard-code are gone from the catalog, and every write that checks the catalog —
 * receiving a donation, editing a campaign — refused them.
 */
export const ITEM_NAME = {
	rice: 'ข้าวสาร',
	water: 'น้ำดื่ม 600 มล.',
	paracetamol: 'ยาพาราเซตามอล 500 มก.',
	soap: 'สบู่ก้อน',
	blanket: 'ผ้าห่มกันหนาว',
	egg: 'ไข่ไก่',
	vegetable: 'ผักรวม'
} as const;

export type ItemKey = keyof typeof ITEM_NAME;

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
