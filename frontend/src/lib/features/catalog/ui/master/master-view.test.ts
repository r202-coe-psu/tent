import { describe, expect, it } from 'vitest';
import type { ItemCategory, ItemMaster, Recipe } from '../../domain/catalog';
import type { UnitOfMeasure } from '../../domain/unit-of-measure';
import {
	categoryItemCount,
	clampPage,
	filterItems,
	filterRecipes,
	filterUnits,
	hiddenDeactivatedItems,
	hiddenDeactivatedRecipes,
	hiddenDeactivatedUnits,
	ingredientSummary,
	pageRange,
	pageSlice,
	unitLines,
	type ItemFilter
} from './master-view';

const SH = 'SH001';

const base = { created_at: '', updated_at: '', created_by: 'test' };

function item(over: Partial<ItemMaster> & { _id: string; name: string }): ItemMaster {
	return {
		...base,
		type: 'item_master',
		schema_v: 1,
		base_unit: 'piece',
		conversions: [],
		type_class: 'consumable',
		dietary: [],
		...over
	} as ItemMaster;
}

function category(over: Partial<ItemCategory> & { _id: string; name: string }): ItemCategory {
	return { ...base, type: 'item_category', schema_v: 1, ...over } as ItemCategory;
}

function unit(over: Partial<UnitOfMeasure> & { code: string }): UnitOfMeasure {
	return {
		...base,
		_id: `unit_of_measure:${over.code}`,
		type: 'unit_of_measure',
		schema_v: 1,
		label_th: over.code,
		label_en: over.code,
		dimension: 'count',
		...over
	} as UnitOfMeasure;
}

function recipe(over: Partial<Recipe> & { _id: string; label: string }): Recipe {
	return {
		...base,
		type: 'recipe',
		schema_v: 1,
		ingredients: [],
		standard_portions: '100',
		standard_duration_hours: '1',
		...over
	} as Recipe;
}

const NO_FILTER: ItemFilter = { q: '', categoryId: 'all', origin: 'all', showDeactivated: false };
const dry = category({ _id: 'item_category:dry', name: 'อาหารแห้ง' });
const drink = category({ _id: 'item_category:drink', name: 'เครื่องดื่ม' });

const rice = item({ _id: 'item_master:rice', name: 'ข้าวสาร', sku: 'RICE-5K', category: dry._id });
const water = item({
	_id: 'item_master:water',
	name: 'น้ำดื่ม',
	sku: 'WTR-600',
	category: drink._id,
	shelter_code: SH
});
const oldMilk = item({
	_id: 'item_master:milk',
	name: 'นมผง',
	category: drink._id,
	deactivated: true
});
const items = [water, oldMilk, rice];

describe('paging', () => {
	it('clamps the page into range', () => {
		expect(clampPage(0, 25, 10)).toBe(1);
		expect(clampPage(9, 25, 10)).toBe(3);
		expect(clampPage(2, 0, 10)).toBe(1);
	});

	it('slices a page', () => {
		const rows = Array.from({ length: 25 }, (_, i) => i);
		expect(pageSlice(rows, 3, 10)).toEqual([20, 21, 22, 23, 24]);
		expect(pageSlice(rows, 99, 10)).toEqual([20, 21, 22, 23, 24]);
	});

	it('reports the visible range', () => {
		expect(pageRange(1, 25, 10)).toEqual({ start: 1, end: 10 });
		expect(pageRange(3, 25, 10)).toEqual({ start: 21, end: 25 });
		expect(pageRange(1, 0, 10)).toEqual({ start: 0, end: 0 });
	});
});

describe('unitLines', () => {
	const fmt = (code: string) => ({ box: 'กล่อง', pack: 'แพ็ค', crate: 'ลัง' })[code] ?? code;

	it('is just the base unit with no conversions', () => {
		expect(unitLines({ base_unit: 'box', conversions: [] }, fmt)).toEqual(['กล่อง']);
	});

	it('adds one line per conversion', () => {
		expect(
			unitLines(
				{
					base_unit: 'box',
					conversions: [
						{ uom_name: 'pack', multiplier: '12' },
						{ uom_name: 'crate', multiplier: '48' }
					]
				},
				fmt
			)
		).toEqual(['กล่อง', '1 แพ็ค = 12 กล่อง', '1 ลัง = 48 กล่อง']);
	});

	it('skips incomplete conversions and shows a dash without a base unit', () => {
		expect(
			unitLines({ base_unit: '', conversions: [{ uom_name: 'pack', multiplier: '' }] }, fmt)
		).toEqual(['—']);
	});
});

describe('filterItems', () => {
	it('hides deactivated items by default and sorts by name', () => {
		expect(filterItems(items, [dry, drink], NO_FILTER, SH).map((i) => i._id)).toEqual([
			'item_master:rice',
			'item_master:water'
		]);
	});

	it('shows deactivated items on request', () => {
		const out = filterItems(items, [dry, drink], { ...NO_FILTER, showDeactivated: true }, SH);
		expect(out).toHaveLength(3);
	});

	it('searches name and SKU', () => {
		expect(filterItems(items, [dry, drink], { ...NO_FILTER, q: 'wtr' }, SH)).toEqual([water]);
		expect(filterItems(items, [dry, drink], { ...NO_FILTER, q: 'ข้าว' }, SH)).toEqual([rice]);
	});

	it('filters by category', () => {
		expect(filterItems(items, [dry, drink], { ...NO_FILTER, categoryId: dry._id }, SH)).toEqual([
			rice
		]);
	});

	it('filters by origin', () => {
		expect(filterItems(items, [dry, drink], { ...NO_FILTER, origin: 'local' }, SH)).toEqual([
			water
		]);
		expect(filterItems(items, [dry, drink], { ...NO_FILTER, origin: 'central' }, SH)).toEqual([
			rice
		]);
	});

	it('counts hidden deactivated items under the other filters', () => {
		expect(hiddenDeactivatedItems(items, [dry, drink], NO_FILTER, SH)).toBe(1);
		expect(
			hiddenDeactivatedItems(items, [dry, drink], { ...NO_FILTER, categoryId: dry._id }, SH)
		).toBe(0);
		expect(
			hiddenDeactivatedItems(items, [dry, drink], { ...NO_FILTER, showDeactivated: true }, SH)
		).toBe(0);
	});

	it('counts items per category', () => {
		expect(categoryItemCount(items, drink, false)).toBe(1);
		expect(categoryItemCount(items, drink, true)).toBe(2);
	});
});

describe('filterUnits', () => {
	const kg = unit({ code: 'kg', label_th: 'กิโลกรัม', label_en: 'Kilogram', dimension: 'mass' });
	const l = unit({ code: 'l', label_th: 'ลิตร', label_en: 'Litre', dimension: 'volume' });
	const old = unit({ code: 'old', label_th: 'เก่า', deactivated: true });
	const units = [kg, l, old];

	it('keeps repository order and hides deactivated', () => {
		expect(filterUnits(units, { q: '', dimension: 'all', showDeactivated: false })).toEqual([
			kg,
			l
		]);
	});

	it('filters by dimension and search', () => {
		expect(filterUnits(units, { q: '', dimension: 'volume', showDeactivated: false })).toEqual([l]);
		expect(filterUnits(units, { q: 'kilo', dimension: 'all', showDeactivated: false })).toEqual([
			kg
		]);
	});

	it('counts hidden deactivated units', () => {
		expect(hiddenDeactivatedUnits(units, { q: '', dimension: 'all', showDeactivated: false })).toBe(
			1
		);
		expect(
			hiddenDeactivatedUnits(units, { q: '', dimension: 'mass', showDeactivated: false })
		).toBe(0);
	});
});

describe('recipes', () => {
	const names: Record<string, string> = { a: 'ข้าวสาร', b: 'อกไก่', c: 'ขิง', d: 'น้ำมัน' };
	const nameOf = (id: string) => names[id] ?? '';
	const ing = (id: string) => ({ item_master_id: id, quantity: '1', uom: 'kg' });
	const congee = recipe({
		_id: 'recipe:congee',
		label: 'โจ๊กไก่',
		ingredients: [ing('a'), ing('b'), ing('c'), ing('d')],
		shelter_code: SH,
		override: true
	});
	const soup = recipe({ _id: 'recipe:soup', label: 'แกงจืด', ingredients: [ing('c')] });
	const gone = recipe({ _id: 'recipe:gone', label: 'สูตรเก่า', deactivated: true });
	const recipes = [congee, soup, gone];
	const f = { q: '', origin: 'all' as const, showDeactivated: false };

	it('hides deactivated recipes and sorts by name', () => {
		expect(filterRecipes(recipes, f, SH, nameOf).map((r) => r._id)).toEqual([
			'recipe:soup',
			'recipe:congee'
		]);
	});

	it('searches the recipe name and its ingredient names', () => {
		expect(filterRecipes(recipes, { ...f, q: 'โจ๊ก' }, SH, nameOf)).toEqual([congee]);
		expect(filterRecipes(recipes, { ...f, q: 'อกไก่' }, SH, nameOf)).toEqual([congee]);
	});

	it('filters by origin', () => {
		expect(filterRecipes(recipes, { ...f, origin: 'override' }, SH, nameOf)).toEqual([congee]);
		expect(filterRecipes(recipes, { ...f, origin: 'central' }, SH, nameOf)).toEqual([soup]);
	});

	it('counts hidden deactivated recipes', () => {
		expect(hiddenDeactivatedRecipes(recipes, f, SH, nameOf)).toBe(1);
	});

	it('summarises ingredients with a tail past three', () => {
		expect(ingredientSummary(congee, nameOf)).toBe('ข้าวสาร, อกไก่, ขิง และอื่น ๆ');
		expect(ingredientSummary(soup, nameOf)).toBe('ขิง');
		expect(ingredientSummary(gone, nameOf)).toBe('—');
	});
});
