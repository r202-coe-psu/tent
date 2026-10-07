import { z } from 'zod';
import { catalogDoc, type CatalogDoc, type AuthorContext } from '$lib/db/model';
import {
	parseQty,
	persistQty,
	qtyGt,
	qtyStrCoercePositiveSchema,
	type QtyValue
} from '$lib/utils/qty';
import { isCanonicalUnitCode, isLegacyUnitLabel, unitCodeSchema } from './unit-of-measure';

// ---------------------------------------------------------------- enums
export const distributionTypeSchema = z.enum(['recurring', 'one_time']);
export type DistributionType = z.infer<typeof distributionTypeSchema>;

export const typeClassSchema = z.enum(['CONSUMABLE', 'DURABLE', 'EQUIPMENT']);
export type TypeClass = z.infer<typeof typeClassSchema>;

export const storageTypeSchema = z.enum(['DRY', 'CHILLED', 'FROZEN', 'CONTROLLED_MED']);
export type StorageType = z.infer<typeof storageTypeSchema>;

export const targetGenderSchema = z.enum(['ALL', 'FEMALE', 'MALE']);
export type TargetGender = z.infer<typeof targetGenderSchema>;

export const ageGroupSchema = z.enum(['ALL', 'INFANT', 'CHILD', 'ELDERLY']);
export type AgeGroup = z.infer<typeof ageGroupSchema>;

export const dietarySchema = z.enum(['HALAL', 'VEGAN']);
export type Dietary = z.infer<typeof dietarySchema>;

export const assetStatusSchema = z.enum(['READY', 'IN_USE', 'MAINTENANCE', 'BROKEN']);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

// ---------------------------------------------------------------- system categories (CR-119)

export const SYSTEM_CATEGORY_KEYS = [
	'FOOD',
	'WATER',
	'WASH',
	'MEDICAL',
	'SPECIAL_CARE',
	'VOLUNTEER_PPE',
	'READY_MEAL',
	'BEDDING',
	'FUEL_ENERGY',
	'KITS'
] as const;

export type SystemCategoryKey = (typeof SYSTEM_CATEGORY_KEYS)[number];

export type SystemItemCategoryDef = {
	key: SystemCategoryKey;
	id: string;
	name: string;
	/** Short Thai name used by legacy docs / early seeds */
	legacy_names: string[];
	default_class: TypeClass;
	description: string;
};

export const SYSTEM_ITEM_CATEGORIES: readonly SystemItemCategoryDef[] = [
	{
		key: 'FOOD',
		id: 'item_category:food',
		name: 'อาหารและวัตถุดิบ (Food Ingredients)',
		legacy_names: ['อาหารและวัตถุดิบ'],
		default_class: 'CONSUMABLE',
		description: 'วัตถุดิบประกอบอาหารสดและแห้งสำหรับโรงครัวกลาง'
	},
	{
		key: 'WATER',
		id: 'item_category:water',
		name: 'น้ำดื่มสะอาด (Drinking Water)',
		legacy_names: ['น้ำดื่มสะอาด'],
		default_class: 'CONSUMABLE',
		description: 'น้ำดื่มบรรจุขวด ถังน้ำดื่มสะอาดสำหรับบริโภค'
	},
	{
		key: 'WASH',
		id: 'item_category:wash',
		name: 'สุขอนามัยและของใช้ส่วนตัว (WASH & Hygiene)',
		legacy_names: ['สุขอนามัยและของใช้ส่วนตัว'],
		default_class: 'CONSUMABLE',
		description: 'สบู่ ยาสระผม แปรงสีฟัน ยาสีฟัน ผ้าอนามัย ผงซักฟอก'
	},
	{
		key: 'MEDICAL',
		id: 'item_category:medical',
		name: 'เวชภัณฑ์และการปฐมพยาบาล (Medical & First Aid)',
		legacy_names: ['เวชภัณฑ์และการปฐมพยาบาล'],
		default_class: 'CONSUMABLE',
		description: 'ยาสามัญประจำบ้าน ยาประจำตัว ชุดทำแผล แอลกอฮอล์ อุปกรณ์การแพทย์'
	},
	{
		key: 'SPECIAL_CARE',
		id: 'item_category:special_care',
		name: 'ของใช้กลุ่มเปราะบาง (Special Care & Vulnerable)',
		legacy_names: ['ของใช้กลุ่มเปราะบาง'],
		default_class: 'CONSUMABLE',
		description: 'ผ้าอ้อมผู้ใหญ่/เด็ก นมผงทารก แผ่นรองซับ สำหรับกลุ่มเฉพาะ'
	},
	{
		key: 'VOLUNTEER_PPE',
		id: 'item_category:volunteer_ppe',
		name: 'อุปกรณ์เจ้าหน้าที่และอาสาสมัคร (PPE & Operations)',
		legacy_names: ['อุปกรณ์เจ้าหน้าที่และอาสาสมัคร'],
		default_class: 'EQUIPMENT',
		description: 'ถุงมือ เสื้อกั๊กสะท้อนแสง รองเท้าบูท อุปกรณ์คุ้มครองความปลอดภัย'
	},
	{
		key: 'READY_MEAL',
		id: 'item_category:ready_meal',
		name: 'อาหารปรุงเสร็จและเครื่องดื่ม (Ready-to-Eat Meals)',
		legacy_names: ['อาหารปรุงเสร็จและเครื่องดื่ม'],
		default_class: 'CONSUMABLE',
		description: 'อาหารปรุงสุกพร้อมรับประทาน ข้าวกล่อง นม สำหรับแจกจ่ายหน้างาน'
	},
	{
		key: 'BEDDING',
		id: 'item_category:bedding',
		name: 'เครื่องนอนและที่พักพิง (Shelter & Bedding)',
		legacy_names: ['เครื่องนอนและที่พักพิง'],
		default_class: 'DURABLE',
		description: 'เสื่อปูนอน มุ้ง ผ้าห่ม หมอน เต็นท์ครอบครัว พัสดุหมุนเวียนยืม-คืน'
	},
	{
		key: 'FUEL_ENERGY',
		id: 'item_category:fuel_energy',
		name: 'เชื้อเพลิงและพลังงาน (Fuel & Energy)',
		legacy_names: ['เชื้อเพลิงและพลังงาน'],
		default_class: 'CONSUMABLE',
		description: 'แก๊สหุงต้ม LPG (15kg/4kg) น้ำมันดีเซลเครื่องปั่นไฟ ถ่านไม้ วัตถุไวไฟ'
	},
	{
		key: 'KITS',
		id: 'item_category:kits',
		name: 'ชุดพัสดุยังชีพรวม (Relief Kits & Packages)',
		legacy_names: ['ชุดพัสดุยังชีพรวม'],
		default_class: 'CONSUMABLE',
		description: 'ถุงยังชีพพระราชทาน ชุดธารน้ำใจ ชุดสุขอนามัยครอบครัว'
	}
] as const;

export function systemCategoryId(key: SystemCategoryKey): string {
	return `item_category:${key.toLowerCase()}`;
}

function findSystemCategoryDef(categoryRef: string): SystemItemCategoryDef | undefined {
	const trimmed = categoryRef.trim();
	if (!trimmed) return undefined;
	return SYSTEM_ITEM_CATEGORIES.find(
		(def) =>
			def.id === trimmed ||
			def.name === trimmed ||
			def.legacy_names.includes(trimmed) ||
			def.key === trimmed
	);
}

/**
 * Resolve a stored `item_master.category` value (id or legacy Thai name) to a category `_id`.
 */
export function resolveCategoryId(
	categoryRef: string | undefined | null,
	categories: readonly Pick<ItemCategory, '_id' | 'name' | 'system_key'>[]
): string | undefined {
	if (!categoryRef) return undefined;
	const trimmed = categoryRef.trim();
	if (!trimmed) return undefined;

	const byId = categories.find((c) => c._id === trimmed);
	if (byId) return byId._id;

	const byName = categories.find((c) => c.name === trimmed);
	if (byName) return byName._id;

	const system = findSystemCategoryDef(trimmed);
	if (system) {
		const live = categories.find((c) => c._id === system.id || c.system_key === system.key);
		return live?._id ?? system.id;
	}

	return undefined;
}

/**
 * Human-readable category label for UI (never raw `item_category:*` ids when known).
 * Prefers live catalog names, then system defs, then the original ref.
 */
export function resolveCategoryLabel(
	categoryRef: string | undefined | null,
	categories: readonly Pick<ItemCategory, '_id' | 'name' | 'system_key'>[] = []
): string {
	if (!categoryRef) return '';
	const trimmed = categoryRef.trim();
	if (!trimmed) return '';

	const byId = categories.find((c) => c._id === trimmed);
	if (byId) return byId.name;

	const byName = categories.find((c) => c.name === trimmed);
	if (byName) return byName.name;

	const system = findSystemCategoryDef(trimmed);
	if (system) {
		const live = categories.find((c) => c._id === system.id || c.system_key === system.key);
		return live?.name ?? system.name;
	}

	return trimmed;
}

/** True when an item belongs to the given category (id or legacy name). */
export function itemBelongsToCategory(
	item: Pick<ItemMaster, 'category'>,
	category: Pick<ItemCategory, '_id' | 'name' | 'system_key'>
): boolean {
	if (!item.category) return false;
	if (item.category === category._id || item.category === category.name) return true;
	const resolved = resolveCategoryId(item.category, [category]);
	return resolved === category._id;
}

export function catalogOrigin(
	doc: { shelter_code?: string; override?: boolean },
	shelterCode?: string | null
): 'central' | 'override' | 'local' {
	if (doc.override && shelterCode && doc.shelter_code === shelterCode) return 'override';
	if (shelterCode && doc.shelter_code === shelterCode && !doc.override) return 'local';
	return 'central';
}

/** Shelter may hard-delete / deactivate only shelter-authored non-override rows. */
export function canShelterDeleteCatalogDoc(
	doc: { shelter_code?: string; override?: boolean },
	shelterCode: string
): boolean {
	return doc.shelter_code === shelterCode && !doc.override;
}

// ---------------------------------------------------------------- documents
export interface Ingredient {
	item_master_id: string;
	quantity: string; // qty_str
	uom: string;
}

export interface UomConversion {
	uom_name: string;
	multiplier: string; // qty_str
	barcode?: string;
}

export interface ItemCategory extends CatalogDoc {
	type: 'item_category';
	name: string;
	system_key?: SystemCategoryKey | string;
	default_class?: TypeClass;
	description?: string;
	is_protected?: boolean;
	is_default?: boolean;
	deactivated?: boolean;
	shelter_code?: string;
	override?: boolean;
}

export interface ItemMaster extends CatalogDoc {
	type: 'item_master';
	name: string;
	category?: string;
	sku?: string;
	description?: string;
	base_unit: string;
	conversions: UomConversion[];
	default_inventory_uom?: string;
	default_issue_uom?: string;
	distribution_type?: DistributionType;
	type_class: TypeClass;
	deactivated?: boolean;
	shelter_code?: string;
	override?: boolean;

	// New fields
	shelf_life_days?: number;
	storage_type?: StorageType;
	allergens?: string;
	target_gender?: TargetGender;
	age_group?: AgeGroup;
	dietary: Dietary[];

	// Durable & Equipment specific fields
	qty_per_person?: number;
	returnable?: boolean;
	asset_status?: AssetStatus;

	// item_category:fuel_energy specific fields (physical tank spec) — plain
	// item_master data, no longer tied to per-tank documents.
	fuel_type?: string;
	capacity_kg?: string;
	burn_rate_kg_per_hour?: string;
	time_multiplier?: string;
}

export interface Recipe extends CatalogDoc {
	type: 'recipe';
	label: string;
	ingredients: Ingredient[];
	standard_portions: string; // qty_str
	standard_duration_hours: string; // qty_str
	deactivated?: boolean;
	shelter_code?: string;
	override?: boolean;
}

// ---------------------------------------------------------------- unit resolution

/** Fallback unit for `item_master` docs written before `base_unit` was required. */
export const DEFAULT_ITEM_UNIT = 'piece';

/**
 * The stock-keeping unit of an `item_master`.
 *
 * `base_unit` is authoritative — every ledger row for the item must carry it.
 * `unit` is the CR-013 transition field and only answers for docs written before
 * `base_unit` existed. Everything that locks a unit for stock (item pickers, the
 * receive/adjust catalog guards, stock-status) must read it through here: when
 * the picker resolved `base_unit` and the guard read the bare `unit` field, every
 * receipt for an `item_master` failed with `expected undefined, got <unit>`.
 */
export function itemMasterUnit(item: { base_unit?: string; unit?: string }): string {
	return item.base_unit || item.unit || DEFAULT_ITEM_UNIT;
}

/**
 * Packaging / alternate UOMs on an item master (`conversions[]`) plus the base unit.
 * Stock ledger rows always store qty in {@link itemMasterUnit}; UI may collect in a
 * packaging UOM and convert via {@link qtyToBaseUnit} before write (§2.1).
 */
export type PackagingUomOption = {
	code: string;
	/** How many base units equal one of this UOM (`1` for the base itself). */
	multiplier: string;
};

export type PackagingSource = {
	base_unit?: string;
	unit?: string;
	conversions?: readonly { uom_name: string; multiplier: string; barcode?: string }[];
	default_inventory_uom?: string;
	default_issue_uom?: string;
};

/** Selectable receive/issue units: base + each packaging conversion. */
export function itemSelectableUoms(item: PackagingSource): PackagingUomOption[] {
	const base = itemMasterUnit(item);
	const options: PackagingUomOption[] = [{ code: base, multiplier: '1' }];
	const seen = new Set([base.trim().toLowerCase()]);

	for (const conversion of item.conversions ?? []) {
		const code = conversion.uom_name?.trim();
		if (!code) continue;
		const key = code.toLowerCase();
		if (seen.has(key)) continue;
		try {
			if (!qtyGt(conversion.multiplier, 0)) continue;
		} catch {
			continue;
		}
		seen.add(key);
		options.push({ code, multiplier: persistQty(conversion.multiplier) });
	}
	return options;
}

export function packagingMultiplier(item: PackagingSource, uomCode: string): string | null {
	const needle = uomCode.trim().toLowerCase();
	if (!needle) return null;
	return (
		itemSelectableUoms(item).find((option) => option.code.trim().toLowerCase() === needle)
			?.multiplier ?? null
	);
}

/** Convert a qty entered in `selectedUom` into `item` base units. */
export function qtyToBaseUnit(qty: QtyValue, selectedUom: string, item: PackagingSource): string {
	const multiplier = packagingMultiplier(item, selectedUom);
	if (multiplier == null) {
		throw new Error(`Unknown unit "${selectedUom}" for item (expected base or packaging UOM)`);
	}
	return persistQty(parseQty(qty).times(multiplier));
}

/** Convert a base-unit qty into `selectedUom` for display. */
export function qtyFromBaseUnit(
	baseQty: QtyValue,
	selectedUom: string,
	item: PackagingSource
): string {
	const multiplier = packagingMultiplier(item, selectedUom);
	if (multiplier == null) {
		throw new Error(`Unknown unit "${selectedUom}" for item (expected base or packaging UOM)`);
	}
	return persistQty(parseQty(baseQty).div(multiplier));
}

function pickDefaultUom(item: PackagingSource, preferred: string | undefined): string {
	const options = itemSelectableUoms(item);
	const base = itemMasterUnit(item);
	if (preferred?.trim()) {
		const hit = options.find(
			(option) => option.code.trim().toLowerCase() === preferred.trim().toLowerCase()
		);
		if (hit) return hit.code;
	}
	return options[0]?.code ?? base;
}

/** Default unit on receive forms (`default_inventory_uom`, else base). */
export function defaultInventoryUom(item: PackagingSource): string {
	return pickDefaultUom(item, item.default_inventory_uom);
}

/** Default unit on distribute/issue forms (`default_issue_uom`, else base). */
export function defaultIssueUom(item: PackagingSource): string {
	return pickDefaultUom(item, item.default_issue_uom);
}

/** Ledger write shape: qty + unit always in item base_unit (§2.1). */
export function toLedgerQtyUnit(
	qty: QtyValue,
	selectedUom: string,
	item: PackagingSource
): { qty: string; unit: string } {
	return {
		qty: qtyToBaseUnit(qty, selectedUom, item),
		unit: itemMasterUnit(item)
	};
}

// ---------------------------------------------------------------- expiry requirement (CR-143 §D)

/** The fields that decide whether a receive must carry `lot.expiry` (either catalog generation). */
export type ExpirySource = {
	storage_type?: StorageType | null;
	shelf_life_days?: number | null;
	/** Legacy `supply_item.perishable` (FR-D3). `item_master` has no such field. */
	perishable?: boolean | null;
};

/** Storage types whose stock cannot be left on the shelf without a date. */
const EXPIRY_STORAGE_TYPES: readonly StorageType[] = ['CHILLED', 'FROZEN'];

function isColdStorage(type: StorageType | null | undefined): boolean {
	return !!type && EXPIRY_STORAGE_TYPES.includes(type);
}

/** A usable shelf life: a finite number of whole days >= 1 (0, negatives and NaN are "unset"). */
function hasShelfLife(days: number | null | undefined): days is number {
	return typeof days === 'number' && Number.isFinite(days) && Math.trunc(days) >= 1;
}

/**
 * Must a receive of this item carry `lot.expiry`? (CR-143 FR-D1, FR-D3)
 *
 * `item_master` never had a `perishable` flag, so this is derived: CHILLED / FROZEN
 * storage, or any `shelf_life_days`. A legacy `supply_item.perishable` still counts.
 */
export function requiresExpiry(item: ExpirySource): boolean {
	if (item.perishable === true) return true;
	if (isColdStorage(item.storage_type)) return true;
	return hasShelfLife(item.shelf_life_days);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` to a UTC date, rejecting values the calendar rolls over (e.g. 02-31). */
function parseIsoDate(value: string | undefined | null): Date | null {
	const match = ISO_DATE.exec((value ?? '').trim());
	if (!match) return null;
	const [, y, m, d] = match;
	const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
	return date.getUTCFullYear() === Number(y) &&
		date.getUTCMonth() === Number(m) - 1 &&
		date.getUTCDate() === Number(d)
		? date
		: null;
}

/**
 * Default `lot.expiry` for an item with a shelf life: `(produced_at ?? received on) +
 * shelf_life_days` (CR-143 FR-D2a). Dates are `YYYY-MM-DD`. `null` when the item has
 * no usable shelf life (FR-D2c: CHILLED / FROZEN without one are keyed by hand) or no
 * valid base date. A blank or invalid `producedAt` falls back to the receive date.
 */
export function suggestExpiry(
	item: ExpirySource,
	producedAt: string | undefined | null,
	receivedOn: string
): { expiry: string; shelfLifeDays: number } | null {
	const days = item.shelf_life_days;
	if (!hasShelfLife(days)) return null;
	const base = parseIsoDate(producedAt) ?? parseIsoDate(receivedOn);
	if (!base) return null;
	base.setUTCDate(base.getUTCDate() + Math.trunc(days));
	return { expiry: base.toISOString().slice(0, 10), shelfLifeDays: Math.trunc(days) };
}

/** FR-D2b — shown beside an auto-filled expiry. UI-only: never written to the ledger. */
export function shelfLifeExpiryLabel(shelfLifeDays: number): string {
	return `คำนวณจากอายุเก็บรักษา ${shelfLifeDays} วัน — กรุณาตรวจสอบกับฉลากอีกครั้ง`;
}

/** FR-D4 — what the chosen storage / shelf life means for stock receipts (item create forms). */
export function expiryRequirementHint(item: ExpirySource): string {
	if (isColdStorage(item.storage_type)) {
		return 'แช่เย็น / แช่แข็ง → ต้องกรอกวันหมดอายุทุกครั้งที่รับเข้า';
	}
	if (hasShelfLife(item.shelf_life_days)) {
		return `ระบุอายุเก็บรักษา ${item.shelf_life_days} วัน → ต้องกรอกวันหมดอายุทุกครั้งที่รับเข้า (ระบบเติมให้ ตรวจสอบกับฉลากอีกครั้ง)`;
	}
	return 'ไม่บังคับกรอกวันหมดอายุตอนรับเข้า (ใส่ได้ถ้ามี)';
}

// ---------------------------------------------------------------- catalog generations

/** One pickable catalog row, whichever generation it came from. */
export type CatalogEntry = {
	_id: string;
	name: string;
	unit: string;
	category: string;
	/** `lot.expiry` is mandatory on receive (CR-143 FR-D1). */
	requiresExpiry: boolean;
};

/**
 * `item_master` replaces `supply_item` (schema.md §4.2, CR-013), but the migration
 * has not been run: the seed still carries BOTH generations of the same goods —
 * `item:rice` and `item_master:rice` — and §4.2's migration note says clients must
 * handle either prefix meanwhile. Item pickers listed the two sources back to back,
 * so staff saw "ข้าวสาร (kg)" twice with no way to tell which id they were binding to.
 *
 * Collapsed on NAME, and the LEGACY `item:` row wins when both exist. That is the
 * opposite of the migration direction and deliberate: every `stock_ledger.item_id`
 * and every `donation_campaign.needs[].item_id` in the data today is an `item:` id,
 * so binding a new campaign to `item_master:rice` would open a second donor card for
 * rice and stop its on-hand from matching (the public projection is keyed
 * `{shelter}:{item_id}` — schema.md §2.4).
 *
 * WHEN THE MIGRATION RUNS, flip `LEGACY_WINS` to false — that is the whole change.
 * An `item_master` with no legacy twin (e.g. `item_master:canned-fish`) is always
 * listed; nothing is hidden, only de-duplicated.
 */
const LEGACY_WINS = true;

export function mergeCatalogGenerations(
	supplyItems: readonly {
		_id: string;
		name: string;
		unit?: string;
		category?: string;
		perishable?: boolean;
	}[],
	itemMasters: readonly {
		_id: string;
		name: string;
		base_unit?: string;
		unit?: string;
		category?: string;
		deactivated?: boolean;
		storage_type?: StorageType;
		shelf_life_days?: number;
	}[]
): CatalogEntry[] {
	const legacy: CatalogEntry[] = supplyItems.map((i) => ({
		_id: i._id,
		name: i.name,
		unit: i.unit || '',
		category: i.category || '',
		requiresExpiry: requiresExpiry(i)
	}));
	const masters: CatalogEntry[] = itemMasters
		.filter((m) => !m.deactivated)
		.map((m) => ({
			_id: m._id,
			name: m.name,
			unit: itemMasterUnit(m) || '',
			category: m.category || '',
			requiresExpiry: requiresExpiry(m)
		}));

	const [preferred, fallback] = LEGACY_WINS ? [legacy, masters] : [masters, legacy];
	const claimed = new Set(preferred.map((e) => e.name.trim().toLowerCase()));
	return [...preferred, ...fallback.filter((e) => !claimed.has(e.name.trim().toLowerCase()))];
}

// ---------------------------------------------------------------- input schemas
export const itemCategoryInputSchema = z.object({
	name: z.string().trim().min(1, 'กรุณาระบุชื่อหมวดสินค้า'),
	default_class: typeClassSchema.optional(),
	description: z.string().trim().optional(),
	is_default: z.boolean().optional(),
	deactivated: z.boolean().optional(),
	override: z.boolean().optional()
});

export type ItemCategoryInput = z.input<typeof itemCategoryInputSchema>;

const itemMasterFieldsSchema = z
	.object({
		name: z.string().trim().min(1, 'กรุณาระบุชื่อสินค้า'),
		category: z.string().trim().optional(),
		sku: z.string().trim().optional(),
		description: z.string().trim().optional(),
		base_unit: z.string().trim().optional(),
		conversions: z
			.array(
				z.object({
					uom_name: z.union([z.literal(''), unitCodeSchema]),
					multiplier: qtyStrCoercePositiveSchema,
					barcode: z.string().trim().optional()
				})
			)
			.default([]),
		default_inventory_uom: z.union([z.literal(''), unitCodeSchema]).optional(),
		default_issue_uom: z.union([z.literal(''), unitCodeSchema]).optional(),
		distribution_type: distributionTypeSchema.optional(),
		type_class: typeClassSchema,
		deactivated: z.boolean().optional(),

		// New fields
		shelf_life_days: z.number().optional(),
		storage_type: storageTypeSchema.optional(),
		allergens: z.string().trim().optional(),
		target_gender: targetGenderSchema.optional(),
		age_group: ageGroupSchema.optional(),
		dietary: z.array(dietarySchema).default([]),

		// Durable & Equipment specific fields
		qty_per_person: z.number().min(0).optional(),
		returnable: z.boolean().optional(),
		asset_status: assetStatusSchema.optional(),
		override: z.boolean().optional(),

		// item_category:fuel_energy specific fields (CR-119/120/125). Empty string
		// tolerated at the object level (form default before the user fills the
		// field in) — conditional requiredness for fuel_energy is enforced below
		// in `validateItemMasterFields`.
		fuel_type: z.literal('LPG').optional(),
		capacity_kg: z.union([z.literal(''), qtyStrCoercePositiveSchema]).optional(),
		burn_rate_kg_per_hour: z.union([z.literal(''), qtyStrCoercePositiveSchema]).optional(),
		time_multiplier: z.union([z.literal(''), qtyStrCoercePositiveSchema]).optional()
	})
	.superRefine((data, ctx) => {
		const codes = (data.conversions ?? [])
			.map((c) => c.uom_name?.trim())
			.filter((code): code is string => !!code);
		const seen = new Set<string>();
		for (const [index, code] of codes.entries()) {
			if (seen.has(code)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'ห้ามใช้รหัสหน่วยเดียวกันซ้ำในสินค้าชิ้นเดียว',
					path: ['conversions', index, 'uom_name']
				});
			}
			seen.add(code);
		}
	});

type ItemMasterFields = z.output<typeof itemMasterFieldsSchema>;

function isLegacyBaseUnit(value: string): boolean {
	const trimmed = value.trim();
	return !isCanonicalUnitCode(trimmed) && isLegacyUnitLabel(trimmed);
}

function validateItemMasterFields(
	data: ItemMasterFields,
	ctx: z.RefinementCtx,
	allowLegacyBaseUnit: boolean
): void {
	const isValidBaseUnit = (value: string): boolean =>
		isCanonicalUnitCode(value) || (allowLegacyBaseUnit && isLegacyBaseUnit(value));

	if (data.type_class !== 'EQUIPMENT') {
		if (!data.base_unit || data.base_unit.trim() === '') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Unit is required',
				path: ['base_unit']
			});
		} else if (!isValidBaseUnit(data.base_unit)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Base unit must be a valid lowercase English code (e.g. kg, piece, can)',
				path: ['base_unit']
			});
		}
		if (!data.distribution_type) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Distribution type is required',
				path: ['distribution_type']
			});
		}
	} else {
		if (data.base_unit && !isValidBaseUnit(data.base_unit)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Base unit must be a valid lowercase English code (e.g. kg, piece, can)',
				path: ['base_unit']
			});
		}
		if (!data.asset_status) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Asset status is required',
				path: ['asset_status']
			});
		}
	}

	// FUEL_ENERGY contract (CR-119/120/125, schema.md): capacity_kg and
	// burn_rate_kg_per_hour are conditionally required for this category.
	if (data.category === 'item_category:fuel_energy') {
		if (!data.capacity_kg || data.capacity_kg === '') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'กรุณาระบุความจุถัง (กก.)',
				path: ['capacity_kg']
			});
		}
		if (!data.burn_rate_kg_per_hour || data.burn_rate_kg_per_hour === '') {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'กรุณาระบุอัตราสิ้นเปลืองแก๊ส (กก./ชม.)',
				path: ['burn_rate_kg_per_hour']
			});
		}
	}
}

export const itemMasterInputSchema = itemMasterFieldsSchema.superRefine((data, ctx) => {
	validateItemMasterFields(data, ctx, false);
});

/** Update schema keeps recognized legacy Thai units readable without allowing new ones. */
export const itemMasterUpdateInputSchema = itemMasterFieldsSchema.superRefine((data, ctx) => {
	validateItemMasterFields(data, ctx, true);
});
export type ItemMasterInput = z.input<typeof itemMasterInputSchema>;
export type ItemMasterUpdateInput = z.input<typeof itemMasterUpdateInputSchema>;

export const recipeInputSchema = z.object({
	label: z.string().trim().min(1, 'Name is required'),
	ingredients: z
		.array(
			z.object({
				item_master_id: z.string().trim(),
				quantity: qtyStrCoercePositiveSchema,
				uom: unitCodeSchema
			})
		)
		.default([]),
	standard_portions: qtyStrCoercePositiveSchema,
	standard_duration_hours: qtyStrCoercePositiveSchema,
	deactivated: z.boolean().optional(),
	override: z.boolean().optional()
});

export type RecipeInput = z.infer<typeof recipeInputSchema>;

// ---------------------------------------------------------------- factories

export function createItemCategory(
	input: ItemCategoryInput,
	ctx: AuthorContext,
	shelterCode?: string
): ItemCategory {
	const d = itemCategoryInputSchema.parse(input);
	const doc = catalogDoc(
		'item_category',
		2,
		{
			name: d.name,
			...(d.default_class ? { default_class: d.default_class } : {}),
			...(d.description ? { description: d.description } : {}),
			...(d.is_default !== undefined ? { is_default: d.is_default } : {}),
			is_protected: false,
			deactivated: d.deactivated ?? false,
			...(shelterCode ? { shelter_code: shelterCode } : {}),
			...(d.override ? { override: d.override } : {})
		},
		ctx.createdBy
	);
	return doc;
}

export function createItemMaster(
	input: ItemMasterInput,
	ctx: AuthorContext,
	shelterCode?: string
): ItemMaster {
	const d = itemMasterInputSchema.parse(input);
	const isFuelEnergy = d.category === 'item_category:fuel_energy';
	const doc = catalogDoc(
		'item_master',
		4,
		{
			name: d.name,
			category: d.category,
			sku: d.sku,
			description: d.description,
			// FUEL_ENERGY contract (CR-119/120/125): base_unit locked to "cylinder".
			base_unit: isFuelEnergy ? 'cylinder' : d.base_unit || 'piece',
			conversions: d.conversions.map((c) => ({
				...c,
				multiplier: persistQty(c.multiplier)
			})),
			default_inventory_uom: d.default_inventory_uom,
			default_issue_uom: d.default_issue_uom,
			distribution_type:
				d.distribution_type || (d.type_class === 'EQUIPMENT' ? undefined : 'recurring'),
			type_class: d.type_class,
			deactivated: d.deactivated ?? false,
			...(shelterCode ? { shelter_code: shelterCode } : {}),
			...(d.override ? { override: d.override } : {}),

			// New fields — FUEL_ENERGY doesn't persist these (schema.md FUEL_ENERGY
			// contract: hide/don't persist unrelated food/distribution fields).
			// `dietary` stays required (empty for FUEL_ENERGY) to match `ItemMaster`.
			dietary: isFuelEnergy ? [] : d.dietary,
			...(isFuelEnergy
				? {}
				: {
						shelf_life_days: d.shelf_life_days,
						storage_type: d.storage_type,
						allergens: d.allergens,
						target_gender: d.target_gender,
						age_group: d.age_group
					}),

			// Durable & Equipment specific fields
			qty_per_person: d.qty_per_person,
			returnable: d.returnable,
			asset_status: d.asset_status,

			// item_category:fuel_energy specific fields (CR-119/120/125)
			...(isFuelEnergy
				? {
						fuel_type: 'LPG' as const,
						capacity_kg: persistQty(d.capacity_kg || '0'),
						burn_rate_kg_per_hour: persistQty(d.burn_rate_kg_per_hour || '0'),
						time_multiplier: persistQty(d.time_multiplier || '1')
					}
				: {})
		},
		ctx.createdBy
	);
	return doc;
}

export function createRecipe(input: RecipeInput, ctx: AuthorContext, shelterCode?: string): Recipe {
	const d = recipeInputSchema.parse(input);
	return catalogDoc(
		'recipe',
		4,
		{
			label: d.label,
			ingredients: d.ingredients.map((i) => ({
				...i,
				quantity: persistQty(i.quantity)
			})),
			standard_portions: persistQty(d.standard_portions),
			standard_duration_hours: persistQty(d.standard_duration_hours),
			deactivated: d.deactivated ?? false,
			...(shelterCode ? { shelter_code: shelterCode } : {}),
			...(d.override ? { override: d.override } : {})
		},
		ctx.createdBy
	);
}
export const isItemCategory = (d: unknown): d is ItemCategory =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'item_category';
export const isItemMaster = (d: unknown): d is ItemMaster =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'item_master';
export const isRecipe = (d: unknown): d is Recipe =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'recipe';
