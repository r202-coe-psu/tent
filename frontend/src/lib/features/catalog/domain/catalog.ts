import { z } from 'zod';
import { catalogDoc, type CatalogDoc, type AuthorContext } from '$lib/db/model';
import { persistQty, qtyStrCoercePositiveSchema } from '$lib/utils/qty';
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

	const system = SYSTEM_ITEM_CATEGORIES.find(
		(def) =>
			def.id === trimmed ||
			def.name === trimmed ||
			def.legacy_names.includes(trimmed) ||
			def.key === trimmed
	);
	if (system) {
		const live = categories.find((c) => c._id === system.id || c.system_key === system.key);
		return live?._id ?? system.id;
	}

	return undefined;
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

	// item_category:fuel_energy specific fields (physical tank spec — a
	// fuel_cylinder auto-created for this item should always match these, not
	// a hardcoded guess).
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

// ---------------------------------------------------------------- catalog generations

/** One pickable catalog row, whichever generation it came from. */
export type CatalogEntry = {
	_id: string;
	name: string;
	unit: string;
	category: string;
	perishable: boolean;
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
	}[]
): CatalogEntry[] {
	const legacy: CatalogEntry[] = supplyItems.map((i) => ({
		_id: i._id,
		name: i.name,
		unit: i.unit || '',
		category: i.category || '',
		perishable: i.perishable ?? false
	}));
	const masters: CatalogEntry[] = itemMasters
		.filter((m) => !m.deactivated)
		.map((m) => ({
			_id: m._id,
			name: m.name,
			unit: itemMasterUnit(m) || '',
			category: m.category || '',
			perishable: false
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
