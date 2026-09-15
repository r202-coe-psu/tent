import { z } from 'zod';
import { catalogDoc, type CatalogDoc, type AuthorContext } from '$lib/db/model';
import { persistQty, qtyStrCoercePositiveSchema, type QtyValue } from '$lib/utils/qty';

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

export const fuelTypeSchema = z.literal('LPG');
export type FuelType = z.infer<typeof fuelTypeSchema>;

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

export interface SystemCategoryDefinition {
	key: SystemCategoryKey;
	id: string;
	name: string;
	default_class: TypeClass;
	description: string;
}

export const SYSTEM_CATEGORY_DEFINITIONS: readonly SystemCategoryDefinition[] = [
	{
		key: 'FOOD',
		id: 'item_category:food',
		name: 'อาหารและวัตถุดิบ (Food Ingredients)',
		default_class: 'CONSUMABLE',
		description: 'วัตถุดิบประกอบอาหารสดและแห้งสำหรับโรงครัวกลาง'
	},
	{
		key: 'WATER',
		id: 'item_category:water',
		name: 'น้ำดื่มสะอาด (Drinking Water)',
		default_class: 'CONSUMABLE',
		description: 'น้ำดื่มบรรจุขวด ถังน้ำดื่มสะอาดสำหรับบริโภค'
	},
	{
		key: 'WASH',
		id: 'item_category:wash',
		name: 'สุขอนามัยและของใช้ส่วนตัว (WASH & Hygiene)',
		default_class: 'CONSUMABLE',
		description: 'สบู่ ยาสระผม แปรงสีฟัน ยาสีฟัน ผ้าอนามัย ผงซักฟอก'
	},
	{
		key: 'MEDICAL',
		id: 'item_category:medical',
		name: 'เวชภัณฑ์และการปฐมพยาบาล (Medical & First Aid)',
		default_class: 'CONSUMABLE',
		description: 'ยาสามัญประจำบ้าน ยาประจำตัว ชุดทำแผล แอลกอฮอล์ อุปกรณ์การแพทย์'
	},
	{
		key: 'SPECIAL_CARE',
		id: 'item_category:special_care',
		name: 'ของใช้กลุ่มเปราะบาง (Special Care & Vulnerable)',
		default_class: 'CONSUMABLE',
		description: 'ผ้าอ้อมผู้ใหญ่/เด็ก นมผงทารก แผ่นรองซับ สำหรับกลุ่มเฉพาะ'
	},
	{
		key: 'VOLUNTEER_PPE',
		id: 'item_category:volunteer_ppe',
		name: 'อุปกรณ์เจ้าหน้าที่และอาสาสมัคร (PPE & Operations)',
		default_class: 'EQUIPMENT',
		description: 'ถุงมือ เสื้อกั๊กสะท้อนแสง รองเท้าบูท อุปกรณ์คุ้มครองความปลอดภัย'
	},
	{
		key: 'READY_MEAL',
		id: 'item_category:ready_meal',
		name: 'อาหารปรุงเสร็จและเครื่องดื่ม (Ready-to-Eat Meals)',
		default_class: 'CONSUMABLE',
		description: 'อาหารปรุงสุกพร้อมรับประทาน ข้าวกล่อง นม สำหรับแจกจ่ายหน้างาน'
	},
	{
		key: 'BEDDING',
		id: 'item_category:bedding',
		name: 'เครื่องนอนและที่พักพิง (Shelter & Bedding)',
		default_class: 'DURABLE',
		description: 'เสื่อปูนอน มุ้ง ผ้าห่ม หมอน เต็นท์ครอบครัว พัสดุหมุนเวียนยืม-คืน'
	},
	{
		key: 'FUEL_ENERGY',
		id: 'item_category:fuel_energy',
		name: 'เชื้อเพลิงและพลังงาน (Fuel & Energy)',
		default_class: 'CONSUMABLE',
		description: 'แก๊สหุงต้ม LPG (15kg/4kg) น้ำมันดีเซลเครื่องปั่นไฟ ถ่านไม้ วัตถุไวไฟ'
	},
	{
		key: 'KITS',
		id: 'item_category:kits',
		name: 'ชุดพัสดุยังชีพรวม (Relief Kits & Packages)',
		default_class: 'CONSUMABLE',
		description: 'ถุงยังชีพพระราชทาน ชุดธารน้ำใจ ชุดสุขอนามัยครอบครัว'
	}
];

export function systemCategoryDocId(key: SystemCategoryKey): string {
	return `item_category:${key.toLowerCase()}`;
}

export function isSystemCategoryDocId(id: string): boolean {
	return SYSTEM_CATEGORY_DEFINITIONS.some((def) => def.id === id);
}

export function categoryReferenceMatches(reference: string, category: ItemCategory): boolean {
	if (!reference) return false;
	if (reference === category._id) return true;
	if (reference === category.name) return true;
	if (category.system_key && reference.toUpperCase() === category.system_key.toUpperCase())
		return true;
	if (reference.toLowerCase() === category._id.replace(/^item_category:/, '')) return true;
	return false;
}

export function isFuelEnergyCategory(category?: string, categories?: ItemCategory[]): boolean {
	if (!category) return false;
	const trimmed = category.trim();
	if (
		trimmed === 'item_category:fuel_energy' ||
		trimmed.toLowerCase() === 'item_category:fuel_energy'
	)
		return true;
	if (trimmed.toUpperCase() === 'FUEL_ENERGY') return true;
	const fuelDef = SYSTEM_CATEGORY_DEFINITIONS.find((def) => def.key === 'FUEL_ENERGY');
	if (fuelDef && (trimmed === fuelDef.name || trimmed === fuelDef.id)) return true;
	if (categories && categories.length > 0) {
		const matched = categories.find((c) => categoryReferenceMatches(trimmed, c));
		if (
			matched &&
			(matched._id === 'item_category:fuel_energy' || matched.system_key === 'FUEL_ENERGY')
		) {
			return true;
		}
	}
	return false;
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

	// CR-120: FUEL_ENERGY (LPG) fields
	fuel_type?: FuelType;
	capacity_kg?: string; // qty_str
	burn_rate_kg_per_hour?: string; // qty_str
	time_multiplier?: string; // qty_str

	// New fields
	shelf_life_days?: number;
	storage_type?: StorageType;
	allergens?: string;
	target_gender?: TargetGender;
	age_group?: AgeGroup;
	dietary?: Dietary[];

	// Durable & Equipment specific fields
	qty_per_person?: number;
	returnable?: boolean;
	asset_status?: AssetStatus;
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
export const DEFAULT_ITEM_UNIT = 'ชิ้น';

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

// ---------------------------------------------------------------- input schemas
export const itemCategoryInputSchema = z.object({
	name: z.string().trim().min(1, 'Name is required'),
	default_class: typeClassSchema.optional(),
	description: z.string().trim().optional(),
	is_default: z.boolean().optional(),
	deactivated: z.boolean().optional(),
	override: z.boolean().optional()
});

export type ItemCategoryInput = z.input<typeof itemCategoryInputSchema>;

export const itemMasterInputSchema = z
	.object({
		name: z.string().trim().min(1, 'Name is required'),
		category: z.string().trim().optional(),
		sku: z.string().trim().optional(),
		description: z.string().trim().optional(),
		base_unit: z.string().trim().optional(),
		conversions: z
			.array(
				z.object({
					uom_name: z.string().trim(),
					multiplier: qtyStrCoercePositiveSchema,
					barcode: z.string().trim().optional()
				})
			)
			.default([]),
		default_inventory_uom: z.string().trim().optional(),
		default_issue_uom: z.string().trim().optional(),
		distribution_type: distributionTypeSchema.optional(),
		type_class: typeClassSchema,
		deactivated: z.boolean().optional(),

		// CR-120: FUEL_ENERGY (LPG) fields
		fuel_type: fuelTypeSchema.optional(),
		capacity_kg: z.preprocess(
			(v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
			qtyStrCoercePositiveSchema.optional()
		),
		burn_rate_kg_per_hour: z.preprocess(
			(v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
			qtyStrCoercePositiveSchema.optional()
		),
		time_multiplier: z.preprocess(
			(v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
			qtyStrCoercePositiveSchema.optional()
		),

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
		override: z.boolean().optional()
	})
	.superRefine((data, ctx) => {
		if (isFuelEnergyCategory(data.category)) {
			if (data.type_class !== 'CONSUMABLE') {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Item in FUEL_ENERGY category must be CONSUMABLE',
					path: ['type_class']
				});
			}
			if (!data.capacity_kg) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Capacity (kg) is required for FUEL_ENERGY',
					path: ['capacity_kg']
				});
			}
			if (!data.burn_rate_kg_per_hour) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Burn rate (kg/hour) is required for FUEL_ENERGY',
					path: ['burn_rate_kg_per_hour']
				});
			}
		}

		if (data.type_class !== 'EQUIPMENT') {
			if (
				!isFuelEnergyCategory(data.category) &&
				(!data.base_unit || data.base_unit.trim() === '')
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Unit is required',
					path: ['base_unit']
				});
			}
			if (!isFuelEnergyCategory(data.category) && !data.distribution_type) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Distribution type is required',
					path: ['distribution_type']
				});
			}
		} else {
			if (!data.asset_status) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Asset status is required',
					path: ['asset_status']
				});
			}
		}
	});
export type ItemMasterInput = z.input<typeof itemMasterInputSchema>;

export const recipeInputSchema = z.object({
	label: z.string().trim().min(1, 'Name is required'),
	ingredients: z
		.array(
			z.object({
				item_master_id: z.string().trim(),
				quantity: qtyStrCoercePositiveSchema,
				uom: z.string().trim()
			})
		)
		.default([]),
	standard_portions: qtyStrCoercePositiveSchema,
	standard_duration_hours: qtyStrCoercePositiveSchema,
	deactivated: z.boolean().optional(),
	override: z.boolean().optional()
});

export type RecipeInput = z.infer<typeof recipeInputSchema>;

// ---------------------------------------------------------------- factories & normalizers

export type NormalizedItemMasterFields = Omit<
	ItemMaster,
	'_id' | '_rev' | 'type' | 'schema_v' | 'created_at' | 'created_by' | 'updated_at'
>;

export function normalizeItemMasterFields(
	input: ItemMasterInput,
	options?: { shelterCode?: string; override?: boolean }
): NormalizedItemMasterFields {
	const isLpg = isFuelEnergyCategory(input.category);

	const base = {
		name: input.name.trim(),
		category: input.category?.trim() || undefined,
		sku: input.sku?.trim() || undefined,
		description: input.description?.trim() || undefined,
		deactivated: input.deactivated ?? false,
		...(options?.shelterCode ? { shelter_code: options.shelterCode } : {}),
		...(options?.override !== undefined
			? { override: options.override }
			: input.override !== undefined
				? { override: input.override }
				: {})
	};

	if (isLpg) {
		return {
			...base,
			type_class: 'CONSUMABLE',
			base_unit: 'ถัง',
			fuel_type: 'LPG',
			capacity_kg: persistQty(input.capacity_kg as QtyValue),
			burn_rate_kg_per_hour: persistQty(input.burn_rate_kg_per_hour as QtyValue),
			time_multiplier: input.time_multiplier ? persistQty(input.time_multiplier as QtyValue) : '1',
			conversions: (input.conversions || []).map((c) => ({
				...c,
				multiplier: persistQty(c.multiplier)
			})),
			default_inventory_uom: input.default_inventory_uom?.trim() || undefined,
			default_issue_uom: input.default_issue_uom?.trim() || undefined,
			distribution_type: input.distribution_type || 'recurring'
		};
	}

	if (input.type_class === 'CONSUMABLE') {
		return {
			...base,
			type_class: 'CONSUMABLE',
			base_unit: input.base_unit || DEFAULT_ITEM_UNIT,
			conversions: (input.conversions || []).map((c) => ({
				...c,
				multiplier: persistQty(c.multiplier)
			})),
			default_inventory_uom: input.default_inventory_uom?.trim() || undefined,
			default_issue_uom: input.default_issue_uom?.trim() || undefined,
			distribution_type: input.distribution_type || 'recurring',
			shelf_life_days: input.shelf_life_days,
			storage_type: input.storage_type,
			allergens: input.allergens?.trim() || undefined,
			target_gender: input.target_gender,
			age_group: input.age_group,
			dietary: input.dietary || []
		};
	}

	if (input.type_class === 'DURABLE') {
		return {
			...base,
			type_class: 'DURABLE',
			base_unit: input.base_unit || DEFAULT_ITEM_UNIT,
			conversions: (input.conversions || []).map((c) => ({
				...c,
				multiplier: persistQty(c.multiplier)
			})),
			default_inventory_uom: input.default_inventory_uom?.trim() || undefined,
			default_issue_uom: input.default_issue_uom?.trim() || undefined,
			distribution_type: input.distribution_type || 'recurring',
			qty_per_person: input.qty_per_person,
			returnable: input.returnable ?? false,
			target_gender: input.target_gender,
			age_group: input.age_group,
			dietary: []
		};
	}

	// EQUIPMENT
	return {
		...base,
		type_class: 'EQUIPMENT',
		base_unit: input.base_unit || DEFAULT_ITEM_UNIT,
		conversions: [],
		asset_status: input.asset_status || 'READY'
	};
}

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
			default_class: d.default_class,
			description: d.description,
			is_protected: false,
			is_default: d.is_default ?? false,
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
	const fields = normalizeItemMasterFields(d, {
		shelterCode,
		override: d.override
	});
	return catalogDoc('item_master', 4, fields, ctx.createdBy);
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
