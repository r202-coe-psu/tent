import { z } from 'zod';
import { type AuthorContext, type BaseDoc, type Timestamp, makeDoc, now } from '$lib/db/model';
import { Description } from 'formsnap';
// import type { Sop } from '$lib/features/shelters';

// ---------------------------------------------------------------- enums
export const distributionTypeSchema = z.enum(['consumable', 'one_time']);
export type DistributionType = z.infer<typeof distributionTypeSchema>;

export const timeFrameSchema = z.enum(['daily', 'weekly']);
export type TimeFrame = z.infer<typeof timeFrameSchema>;

export const targetAudienceTypeSchema = z.enum(['all', 'specific_segments']);
export type TargetAudienceType = z.infer<typeof targetAudienceTypeSchema>;

export const genders = z.enum(['male', 'female', 'other']);
export type Genders = z.infer<typeof genders>;

export const vulnerableGroups = z.enum(['elderly', 'pregnant', 'bedridden', 'infant', 'isolated']);
export type VulnerableGroups = z.infer<typeof vulnerableGroups>;

export const dietReligions = z.enum(['halal', 'vegetarian', 'vegan']);
export type DietReligions = z.infer<typeof dietReligions>;

// ---------------------------------------------------------------- documents
export interface Ingredient {
	item_master_id: string;
	quantity: number;
	uom: string;
}

export interface UomConversion {
	uom_name: string;
	multiplier: number;
	barcode?: string;
}

export interface TargetRestrictions {
	genders?: Genders[];
	vulnerable_groups?: VulnerableGroups[];
	diet_religions?: DietReligions[];
}

export interface ItemCategory extends BaseDoc {
	type: 'item_category';
	name: string;
	is_default: boolean;
}

export interface ItemMaster extends BaseDoc {
	type: 'item_master';
	name: string;
	category?: string;
	sku?: string;
	description?: string;
	base_unit: string;
	conversions: UomConversion[];
	default_purchasing_uom?: string;
	default_inventory_uom?: string;
	default_issue_uom?: string;
	distribution_type: DistributionType;
	target_reserve_days?: number;
	consumption_rate?: number;
	unit?: string;
	timeframe?: string;
	sphere_standard?: number;
	overstock_alert_days?: number;
	target_audience_type: TargetAudienceType;
	target_restrictions: TargetRestrictions;
	is_default: boolean;
}

export interface Recipe extends BaseDoc {
	type: 'recipe';
	label: string;
	ingredients: Ingredient[];
	standard_portions: number;
	standard_duration_hours: number;
	is_default: boolean;
}

// ---------------------------------------------------------------- input schemas
export const itemCategoryInputSchema = z.object({
	name: z.string().trim().min(1, 'Name is required'),
	is_default: z.boolean().default(false)
});

export type ItemCategoryInput = z.input<typeof itemCategoryInputSchema>;

export const itemMasterInputSchema = z.object({
	name: z.string().trim().min(1, 'Name is required'),
	category: z.string().trim().optional(),
	sku: z.string().trim().optional(),
	description: z.string().trim().optional(),
	base_unit: z.string().trim().min(1, 'Unit is required'),
	conversions: z
		.array(
			z.object({
				uom_name: z.string().trim(),
				multiplier: z.number().min(1),
				barcode: z.string().trim().optional()
			})
		)
		.default([]),
	default_purchasing_uom: z.string().trim().optional(),
	default_inventory_uom: z.string().trim().optional(),
	default_issue_uom: z.string().trim().optional(),
	distribution_type: distributionTypeSchema,
	target_reserve_days: z.number().optional(),
	consumption_rate: z.number().optional(),
	unit: z.string().trim().optional(),
	timeframe: timeFrameSchema.optional(),
	sphere_standard: z.number().optional(),
	overstock_alert_days: z.number().optional(),
	target_audience_type: targetAudienceTypeSchema,
	target_restrictions: z.object({
		genders: z.array(genders).optional(),
		vulnerable_groups: z.array(vulnerableGroups).optional(),
		diet_religions: z.array(dietReligions).optional()
	}),
	is_default: z.boolean().default(false)
});
export type ItemMasterInput = z.infer<typeof itemMasterInputSchema>;

export const recipeInputSchema = z.object({
	label: z.string().trim().min(1, 'Name is required'),
	ingredients: z
		.array(
			z.object({
				item_master_id: z.string().trim(),
				quantity: z.number(),
				uom: z.string().trim()
			})
		)
		.default([]),
	standard_portions: z.number().positive(),
	standard_duration_hours: z.number().positive(),
	is_default: z.boolean()
});

export type RecipeInput = z.infer<typeof recipeInputSchema>;

// ---------------------------------------------------------------- factories

export function createItemCategory(input: ItemCategoryInput, ctx: AuthorContext): ItemCategory {
	const d = itemCategoryInputSchema.parse(input);
	const doc = makeDoc(
		'item_category',
		1,
		{
			name: d.name,
			is_default: d.is_default
		},
		ctx
	);
	return doc;
}

export function createItemMaster(input: ItemMasterInput, ctx: AuthorContext): ItemMaster {
	const d = itemMasterInputSchema.parse(input);
	const doc = makeDoc(
		'item_master',
		1,
		{
			name: d.name,
			category: d.category,
			sku: d.sku,
			description: d.description,
			base_unit: d.base_unit,
			conversions: d.conversions,
			default_purchasing_uom: d.default_purchasing_uom,
			default_inventory_uom: d.default_inventory_uom,
			default_issue_uom: d.default_issue_uom,
			distribution_type: d.distribution_type,
			target_reserve_days: d.target_reserve_days,
			consumption_rate: d.consumption_rate,
			unit: d.unit,
			timeframe: d.timeframe,
			sphere_standard: d.sphere_standard,
			overstock_alert_days: d.overstock_alert_days,
			target_audience_type: d.target_audience_type,
			target_restrictions: d.target_restrictions,
			is_default: d.is_default
		},
		ctx
	);
	return doc;
}

export function createRecipe(input: RecipeInput, ctx: AuthorContext): Recipe {
	const d = recipeInputSchema.parse(input);
	return makeDoc(
		'recipe',
		1,
		{
			label: d.label,
			ingredients: d.ingredients,
			standard_portions: d.standard_portions,
			standard_duration_hours: d.standard_duration_hours,
			is_default: d.is_default
		},
		ctx
	);
}
export const isItemCategory = (d: unknown): d is ItemCategory =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'item_category';
export const isItemMaster = (d: unknown): d is ItemMaster =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'item_master';
export const isRecipe = (d: unknown): d is Recipe =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'recipe';
