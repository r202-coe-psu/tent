import Fuse, { type IFuseOptions } from 'fuse.js';
import {
	findItemByBarcode,
	isMergedItem,
	itemMasterUnit,
	mergedAliasesByTarget,
	type PackagingSource
} from '$lib/features/catalog';

/** Item row for receive / distribute / adjust pickers (and A6 transfer). */
export type StockFormItem = PackagingSource & {
	_id: string;
	name: string;
	unit: string;
	perishable?: boolean;
	sku?: string;
	/** Names of items merged into this one (CR-143 FR-F5): searching an old name finds it. */
	aliases?: string[];
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
	conversions?: readonly { uom_name: string; multiplier: string; barcode?: string }[];
	default_inventory_uom?: string;
	default_issue_uom?: string;
	deactivated?: boolean;
	merged_into?: string;
};

/**
 * Merge legacy supply items and active item masters into the shared picker shape.
 * Supply items come first; deactivated and merged-away masters are dropped, and a
 * destination carries its merged sources' names as search aliases (CR-143 FR-F5).
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

	const aliasesByTarget = mergedAliasesByTarget(itemMasters);
	const mappedMasters = itemMasters
		.filter((im) => !im.deactivated && !isMergedItem(im))
		.map((im) => {
			const unit = itemMasterUnit(im);
			const aliases = aliasesByTarget.get(im._id);
			return {
				_id: im._id,
				name: im.name,
				unit,
				base_unit: unit,
				conversions: [...(im.conversions ?? [])],
				default_inventory_uom: im.default_inventory_uom,
				default_issue_uom: im.default_issue_uom,
				perishable: false,
				...(im.sku !== undefined ? { sku: im.sku } : {}),
				...(aliases?.length ? { aliases } : {})
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
		{ name: 'skuNorm', weight: 0.1 },
		{ name: 'aliases', weight: 0.5 }
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
 * An item whose barcode equals the query (a scanner typing into the box) always comes first.
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

	const ranked = results.map(({ item }) => {
		const { skuNorm, ...rest } = item;
		void skuNorm;
		return rest;
	});

	const scanned = findItemByBarcode(items, needle)?.item;
	if (!scanned) return ranked;
	return [scanned, ...ranked.filter((item) => item._id !== scanned._id)];
}
