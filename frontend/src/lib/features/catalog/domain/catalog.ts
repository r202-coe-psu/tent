import { z } from 'zod';
import { catalogDoc, type CatalogDoc, type AuthorContext } from '$lib/db/model';
import { persistQty, qtyStrCoercePositiveSchema } from '$lib/utils/qty';

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
		if (data.type_class !== 'EQUIPMENT') {
			if (!data.base_unit || data.base_unit.trim() === '') {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Unit is required',
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
	const doc = catalogDoc(
		'item_master',
		4,
		{
			name: d.name,
			category: d.category,
			sku: d.sku,
			description: d.description,
			base_unit: d.base_unit || 'ชิ้น',
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

			// New fields
			shelf_life_days: d.shelf_life_days,
			storage_type: d.storage_type,
			allergens: d.allergens,
			target_gender: d.target_gender,
			age_group: d.age_group,
			dietary: d.dietary,

			// Durable & Equipment specific fields
			qty_per_person: d.qty_per_person,
			returnable: d.returnable,
			asset_status: d.asset_status
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
