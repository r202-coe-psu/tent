import Fuse, { type IFuseOptions } from 'fuse.js';
import { itemMasterUnit, type PackagingSource } from '$lib/features/catalog';

/** Item row for receive / distribute / adjust pickers (and A6 transfer). */
export type StockFormItem = PackagingSource & {
	_id: string;
	name: string;
	unit: string;
	perishable?: boolean;
	sku?: string;
};

/** Minimal supply-item fields needed to build a {@link StockFormItem}. */
export type StockFormSupplySource = {
	_id: string;
	name: string;
	unit: string;
	perishable: boolean;
};

/** Minimal item-master fields needed to build a {@link StockFormItem}. */
export type StockFormMasterSource = {
	_id: string;
	name: string;
	base_unit?: string;
	unit?: string;
	sku?: string;
	conversions?: readonly { uom_name: string; multiplier: string }[];
	default_inventory_uom?: string;
	default_issue_uom?: string;
	deactivated?: boolean;
};

/**
 * Merge legacy supply items and active item masters into the shared picker shape.
 * Supply items come first; deactivated masters are dropped.
 */
export function toStockFormItems(
	supplyItems: readonly StockFormSupplySource[],
	itemMasters: readonly StockFormMasterSource[]
): StockFormItem[] {
	const mappedSupply = supplyItems.map((item) => ({
		_id: item._id,
		name: item.name,
		unit: item.unit,
		base_unit: item.unit,
		conversions: [] as { uom_name: string; multiplier: string }[],
		perishable: item.perishable
	}));

	const mappedMasters = itemMasters
		.filter((im) => !im.deactivated)
		.map((im) => {
			const unit = itemMasterUnit(im);
			return {
				_id: im._id,
				name: im.name,
				unit,
				base_unit: unit,
				conversions: [...(im.conversions ?? [])],
				default_inventory_uom: im.default_inventory_uom,
				default_issue_uom: im.default_issue_uom,
				perishable: false,
				...(im.sku !== undefined ? { sku: im.sku } : {})
			};
		});

	return [...mappedSupply, ...mappedMasters];
}

/** Strip separators so `WAT-01` and `WAT01` compare equal under fuzzy search. */
function normalizeSku(sku: string): string {
	return sku.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

type StockFormSearchDoc = StockFormItem & { skuNorm: string };

const FUSE_OPTIONS: IFuseOptions<StockFormSearchDoc> = {
	keys: [
		{ name: 'name', weight: 0.7 },
		{ name: 'sku', weight: 0.2 },
		{ name: 'skuNorm', weight: 0.1 }
	],
	threshold: 0.4,
	ignoreLocation: true,
	includeScore: true
};

function toSearchDocs(items: readonly StockFormItem[]): StockFormSearchDoc[] {
	return items.map((item) => ({
		...item,
		skuNorm: item.sku ? normalizeSku(item.sku) : ''
	}));
}

/**
 * Fuzzy filter on item name or SKU (typos + separator-insensitive SKU).
 * Empty/whitespace query returns all items in original order; otherwise ranked by score.
 */
export function filterStockFormItems(
	items: readonly StockFormItem[],
	query: string
): StockFormItem[] {
	const needle = query.trim();
	if (!needle) return [...items];

	const fuse = new Fuse(toSearchDocs(items), FUSE_OPTIONS);
	const results = fuse.search(needle);

	// Also search the normalized needle so `WAT01` hits `skuNorm` of `WAT-01`.
	const normalizedNeedle = normalizeSku(needle);
	if (normalizedNeedle && normalizedNeedle !== needle.toLowerCase()) {
		const seen = new Set(results.map((r) => r.item._id));
		for (const extra of fuse.search(normalizedNeedle)) {
			if (!seen.has(extra.item._id)) results.push(extra);
		}
		results.sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
	}

	return results.map(({ item }) => {
		const { skuNorm, ...rest } = item;
		void skuNorm;
		return rest;
	});
}
