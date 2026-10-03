import { catalogOrigin, itemBelongsToCategory } from '../../domain/catalog';
import { isBaseUnitRow } from '../../domain/item-barcode';
import { missingOptionalFields } from '../../domain/item-similarity';
import type { ItemCategory, ItemMaster, Recipe } from '../../domain/catalog';
import type { Dimension, UnitOfMeasure } from '../../domain/unit-of-measure';

/** Rows per page on every master data list (items, units, recipes). */
export const MASTER_PAGE_SIZE = 10;

export type CatalogOriginKey = 'central' | 'override' | 'local';
export type OriginFilter = CatalogOriginKey | 'all';

export type MasterBadgeTone =
	'slate' | 'amber' | 'sky' | 'green' | 'red' | 'blue' | 'orange' | 'cyan' | 'purple';

export type ItemSheetMode = 'view' | 'edit' | 'create';

/** What the shelter or central admin may do to an item besides editing it. */
export type ItemSheetAction = 'delete' | 'reset' | 'toggle' | 'central' | 'none';

/** One item as the list renders it — display strings resolved by the panel. */
export interface MasterItemRow {
	item: ItemMaster;
	categoryLabel: string;
	unitLines: string[];
	origin: CatalogOriginKey;
	/** Optional fields still empty, shown when the user could fill them in. */
	missing: string[];
	/** Created within the last day. */
	isNew: boolean;
	/** On-hand quantity with its unit; `null` when the list has no stock column. */
	stock: string | null;
	/** Offer "เติมข้อมูล": the user may edit this item and it has gaps. */
	canFill: boolean;
}

export type FilterOption = { value: string; label: string };

export type SelectFilter = {
	id: string;
	/** Accessible name, e.g. "กรองหมวดหมู่". */
	label: string;
	/** Shown before the value, e.g. "หมวด". */
	prefix: string;
	value: string;
	options: FilterOption[];
	/** Label of the 'all' option. */
	allLabel?: string;
};

export const ORIGIN_LABELS: Record<CatalogOriginKey, string> = {
	central: 'ส่วนกลาง',
	override: 'ปรับแต่งแล้ว',
	local: 'เฉพาะศูนย์'
};

export const ORIGIN_TONES: Record<CatalogOriginKey, MasterBadgeTone> = {
	central: 'slate',
	override: 'amber',
	local: 'sky'
};

// ---------------------------------------------------------------- paging

export function totalPages(count: number, perPage: number): number {
	return Math.max(1, Math.ceil(count / perPage));
}

/** Clamp a 1-based page into range for `count` rows. */
export function clampPage(page: number, count: number, perPage: number): number {
	return Math.min(Math.max(1, Math.trunc(page) || 1), totalPages(count, perPage));
}

export function pageSlice<T>(rows: readonly T[], page: number, perPage: number): T[] {
	const p = clampPage(page, rows.length, perPage);
	return rows.slice((p - 1) * perPage, p * perPage);
}

/** 1-based inclusive range shown on a page; `{0, 0}` when empty. */
export function pageRange(
	page: number,
	count: number,
	perPage: number
): { start: number; end: number } {
	if (count === 0) return { start: 0, end: 0 };
	const p = clampPage(page, count, perPage);
	return { start: (p - 1) * perPage + 1, end: Math.min(p * perPage, count) };
}

// ---------------------------------------------------------------- shared

const byThaiName = (a: string, b: string) => a.localeCompare(b, 'th');

function matchesText(needle: string, ...fields: (string | undefined | null)[]): boolean {
	if (!needle) return true;
	return fields.some((f) => !!f && f.toLowerCase().includes(needle));
}

// ---------------------------------------------------------------- items

/**
 * The unit cell of an item: the base unit on the first line, then one line per
 * conversion ("1 แพ็ค = 12 กล่อง"). `format` turns a unit code into its label.
 */
export function unitLines(
	item: Pick<ItemMaster, 'base_unit' | 'conversions'>,
	format: (code: string) => string
): string[] {
	const base = format(item.base_unit);
	const lines = (item.conversions ?? [])
		.filter((c) => c.uom_name && c.multiplier && !isBaseUnitRow(c, item.base_unit ?? ''))
		.map((c) => `1 ${format(c.uom_name)} = ${c.multiplier} ${base}`);
	return [base || '—', ...lines];
}

/** Quick filter chips above the item list. `central` includes shelter overrides of central items. */
export type ScopeChip = 'all' | 'incomplete' | 'local' | 'central';

export const SCOPE_CHIP_LABELS: Record<ScopeChip, string> = {
	all: 'ทั้งหมด',
	incomplete: 'ข้อมูลไม่ครบ',
	local: 'ของศูนย์นี้',
	central: 'ส่วนกลาง'
};

export interface ItemFilter {
	q: string;
	/** An `ItemCategory._id`, or 'all'. */
	categoryId: string;
	origin: OriginFilter;
	showDeactivated: boolean;
	/** Quick chip; omitted means 'all'. */
	scope?: ScopeChip;
}

/**
 * "ข้อมูลไม่ครบ": the item lacks optional fields the user can still fill in. In a
 * shelter only its own items count — it cannot edit a central item, only override it.
 */
export function isIncompleteItem(item: ItemMaster, shelterCode: string | null): boolean {
	if (shelterCode && catalogOrigin(item, shelterCode) !== 'local') return false;
	return missingOptionalFields(item).length > 0;
}

function matchesScope(item: ItemMaster, scope: ScopeChip, shelterCode: string | null): boolean {
	switch (scope) {
		case 'all':
			return true;
		case 'incomplete':
			return isIncompleteItem(item, shelterCode);
		case 'local':
			return catalogOrigin(item, shelterCode) === 'local';
		case 'central':
			return catalogOrigin(item, shelterCode) !== 'local';
	}
}

const NEW_ITEM_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Created within the last 24 hours — drives the "ใหม่" badge. */
export function isNewItem(item: Pick<ItemMaster, 'created_at'>, now: number = Date.now()): boolean {
	const created = Date.parse(item.created_at);
	return Number.isFinite(created) && now - created >= 0 && now - created < NEW_ITEM_WINDOW_MS;
}

function matchesItem(
	item: ItemMaster,
	categories: readonly ItemCategory[],
	filter: ItemFilter,
	shelterCode: string | null
): boolean {
	if (filter.categoryId !== 'all') {
		const category = categories.find((c) => c._id === filter.categoryId);
		if (!category || !itemBelongsToCategory(item, category)) return false;
	}
	if (filter.origin !== 'all' && catalogOrigin(item, shelterCode) !== filter.origin) return false;
	if (!matchesScope(item, filter.scope ?? 'all', shelterCode)) return false;
	return matchesText(filter.q.trim().toLowerCase(), item.name, item.sku);
}

/** Items that pass every filter, sorted by name. */
export function filterItems(
	items: readonly ItemMaster[],
	categories: readonly ItemCategory[],
	filter: ItemFilter,
	shelterCode: string | null
): ItemMaster[] {
	return items
		.filter(
			(i) =>
				(filter.showDeactivated || !i.deactivated) &&
				matchesItem(i, categories, filter, shelterCode)
		)
		.sort((a, b) => byThaiName(a.name, b.name));
}

/** Deactivated items hidden by the "แสดงที่ปิดใช้งาน" switch (the other filters still apply). */
export function hiddenDeactivatedItems(
	items: readonly ItemMaster[],
	categories: readonly ItemCategory[],
	filter: ItemFilter,
	shelterCode: string | null
): number {
	if (filter.showDeactivated) return 0;
	return items.filter((i) => i.deactivated && matchesItem(i, categories, filter, shelterCode))
		.length;
}

/**
 * Count per quick chip. Search, category and the deactivated switch still apply, but
 * the chip itself does not, so every chip shows what it would list if picked.
 */
export function countScopeChips(
	items: readonly ItemMaster[],
	categories: readonly ItemCategory[],
	filter: ItemFilter,
	shelterCode: string | null
): Record<ScopeChip, number> {
	const counts: Record<ScopeChip, number> = { all: 0, incomplete: 0, local: 0, central: 0 };
	for (const item of items) {
		if (!filter.showDeactivated && item.deactivated) continue;
		if (!matchesItem(item, categories, { ...filter, scope: 'all' }, shelterCode)) continue;
		counts.all++;
		for (const chip of ['incomplete', 'local', 'central'] as const) {
			if (matchesScope(item, chip, shelterCode)) counts[chip]++;
		}
	}
	return counts;
}

/** Items per category, ignoring search and deactivated ones unless `showDeactivated`. */
export function categoryItemCount(
	items: readonly ItemMaster[],
	category: ItemCategory,
	showDeactivated: boolean
): number {
	return items.filter(
		(i) => itemBelongsToCategory(i, category) && (showDeactivated || !i.deactivated)
	).length;
}

// ---------------------------------------------------------------- units

export interface UnitFilter {
	q: string;
	dimension: Dimension | 'all';
	showDeactivated: boolean;
}

function matchesUnit(unit: UnitOfMeasure, filter: UnitFilter): boolean {
	if (filter.dimension !== 'all' && unit.dimension !== filter.dimension) return false;
	return matchesText(
		filter.q.trim().toLowerCase(),
		unit.code,
		unit.label_th,
		unit.label_th_short,
		unit.label_en,
		unit.dimension
	);
}

/** Units that pass every filter, in the order the repository returned them. */
export function filterUnits(units: readonly UnitOfMeasure[], filter: UnitFilter): UnitOfMeasure[] {
	return units.filter((u) => (filter.showDeactivated || !u.deactivated) && matchesUnit(u, filter));
}

export function hiddenDeactivatedUnits(
	units: readonly UnitOfMeasure[],
	filter: UnitFilter
): number {
	if (filter.showDeactivated) return 0;
	return units.filter((u) => u.deactivated && matchesUnit(u, filter)).length;
}

// ---------------------------------------------------------------- recipes

export interface RecipeFilter {
	q: string;
	origin: OriginFilter;
	showDeactivated: boolean;
}

/** Resolves an `item_master` id to its display name ('' when unknown). */
export type IngredientNameOf = (itemMasterId: string) => string;

function matchesRecipe(
	recipe: Recipe,
	filter: RecipeFilter,
	shelterCode: string | null,
	nameOf: IngredientNameOf
): boolean {
	if (filter.origin !== 'all' && catalogOrigin(recipe, shelterCode) !== filter.origin) return false;
	const needle = filter.q.trim().toLowerCase();
	if (!needle) return true;
	return (
		matchesText(needle, recipe.label) ||
		recipe.ingredients.some((ing) => matchesText(needle, nameOf(ing.item_master_id)))
	);
}

/** Recipes that pass every filter, sorted by name. */
export function filterRecipes(
	recipes: readonly Recipe[],
	filter: RecipeFilter,
	shelterCode: string | null,
	nameOf: IngredientNameOf
): Recipe[] {
	return recipes
		.filter(
			(r) =>
				(filter.showDeactivated || !r.deactivated) && matchesRecipe(r, filter, shelterCode, nameOf)
		)
		.sort((a, b) => byThaiName(a.label, b.label));
}

export function hiddenDeactivatedRecipes(
	recipes: readonly Recipe[],
	filter: RecipeFilter,
	shelterCode: string | null,
	nameOf: IngredientNameOf
): number {
	if (filter.showDeactivated) return 0;
	return recipes.filter((r) => r.deactivated && matchesRecipe(r, filter, shelterCode, nameOf))
		.length;
}

/** "ข้าวสาร, อกไก่, ขิง และอื่น ๆ" — the first `max` names, with a tail when there are more. */
export function ingredientSummary(
	recipe: Pick<Recipe, 'ingredients'>,
	nameOf: IngredientNameOf,
	max = 3
): string {
	const names = recipe.ingredients.map((i) => nameOf(i.item_master_id)).filter(Boolean);
	if (names.length === 0) return '—';
	const head = names.slice(0, max).join(', ');
	return names.length > max ? `${head} และอื่น ๆ` : head;
}
