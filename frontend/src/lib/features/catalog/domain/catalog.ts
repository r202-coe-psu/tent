import { z } from 'zod';
import {
    type AuthorContext,
    type BaseDoc,
    type Timestamp,
    makeDoc,
    now,
} from '$lib/db/model';
import type { Sop } from '$lib/features/shelters';

// ---------------------------------------------------------------- enums

export const supplyItemCategorySchema = z.enum(['food', 'water', 'medicine', 'clothing', 'hygiene', 'bedding', 'equipment', 'other']);
export type Category = z.infer<typeof supplyItemCategorySchema>;





export const tageSchema = z.enum([
    'halal',
    'soft_food',
    'vegetarian',
    'infant'
]);
export type Tage = z.infer<typeof tageSchema>;


// ---------------------------------------------------------------- documents
export interface  Ingredient {
    item_id: string;
    qty: number;
    unit: string;
}

// export interface SupplyItem {
//     name: string;
//     category: Category;
//     unit: string;
//     reorder_level?: number | null;
//     perishable: boolean;
// }

// export interface sopProfile {
//     name: string;
//     // ratios: 
//     version: number;
//     active: boolean;

// }

// export interface recipe {
//     name: string;
//     serving_unit: string;
//     ingredient: Ingredient;
//     tage: Tage;     
// }

export interface SupplyItem extends BaseDoc {
    type: 'supply_item';
    name: string;
    category: Category;
    unit: string;
    reorder_level: number | null;
    perishable: boolean
}

export interface SopProfile extends BaseDoc {
    type: 'sopprofile';
    name: string;
    // ratios: ;
    version: number;
    active: boolean;
}

export interface Recipe extends BaseDoc {
    type: 'recipe';
    name: string;
    serving_unit: string;
    ingredient: Ingredient;
    tage: Tage;
    active: boolean;
}




// ---------------------------------------------------------------- input schemas
export const supplyItemInputSchema = z.object({
    name: z.string().trim().min(1, 'Name is required'),
    category: supplyItemCategorySchema,
    unit: z.string().trim().min(1, 'กรุณากรอกหน่วยนับ'),
    reorder_level: z.number().int().nullable().optional(),
    perishable: z.boolean().default(false),
});

export type SupplyItemInput = z.input<typeof supplyItemInputSchema>;


export const sopProfileInputSchema = z.object({
    name: z.string().trim().min(1, 'Name is required'),
    // ratios: z.
    version: z.number().int(),
    active: z.boolean().default(false),
});

export type SopProfileInput = z.input<typeof sopProfileInputSchema>;

export const recipeInputSchema = z.object({
    name: z.string().trim().min(1, 'Name is required'),
    serving_unit: z.string().trim().min(1, 'Unit is required'),
    ingredient: z.object({
        item_id:z.string().trim(),
        qty:z.number(),
        unit: z.string().trim()
    }),
    tage: tageSchema,
    active: z.boolean().default(false),
});

export type RecipeInput = z.input<typeof recipeInputSchema>;


// ---------------------------------------------------------------- factories
export function createSupplyItem(input: SupplyItemInput, ctx: AuthorContext): SupplyItem {
    const d = supplyItemInputSchema.parse(input);
    const doc = makeDoc(
        'supply_item',
        1,
        {
            name: d.name,
            category: d.category,
            unit: d.unit,
            reorder_level: d.reorder_level ?? null,
            perishable: d.perishable,
        },
        ctx
    );
    const suffix = doc._id.includes(':') ? doc._id.split(':')[1] : doc._id;
    doc._id = `item:${suffix}`;
    return doc;
}

export function createSopProfile(input: SopProfileInput, ctx: AuthorContext): SopProfile {
    const d = sopProfileInputSchema.parse(input);
    return makeDoc(
        'sopprofile',
        1,
        {
            name: d.name,
            // ratios:
            version: d.version,
            active: d.active,
        },
        ctx
    );
}

export function createRecipe(input: RecipeInput, ctx: AuthorContext): Recipe {
    const d = recipeInputSchema.parse(input);
    return makeDoc(
        'recipe',
        1,
        {
            name: d.name,
            serving_unit: d.serving_unit,
            ingredient: d.ingredient,
            tage: d.tage,
            active: d.active
        },
        ctx
    );
}

// ---------------------------------------------------------------- type guards

export const isSupplyItem = (d: unknown): d is SupplyItem =>
    !!d && typeof d === 'object' && (d as { type?: unknown }).type === 'supply_item';
export const isSopProfile = (d: unknown): d is SopProfile =>
    !!d && typeof d === 'object' && (d as { type?: unknown}).type === 'sopprofile';
export const isRecipe = (d: unknown): d is Recipe =>
    !!d && typeof d === 'object' && (d as { type?: unknown}).type === 'recipe';