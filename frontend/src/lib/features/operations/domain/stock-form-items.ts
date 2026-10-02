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

/** Case-insensitive match on item name or SKU. Empty/whitespace query returns all. */
export function filterStockFormItems(
	items: readonly StockFormItem[],
	query: string
): StockFormItem[] {
	const needle = query.toLowerCase().trim();
	if (!needle) return [...items];
	return items.filter((item) => {
		if (item.name.toLowerCase().includes(needle)) return true;
		return (item.sku ?? '').toLowerCase().includes(needle);
	});
}
