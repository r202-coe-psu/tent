/** Display label for a transfer line: item name (raw id fallback) + qty + unit. */
export function transferItemLabel(
	item: { item_id: string; qty: string | number; unit: string },
	namesById: ReadonlyMap<string, string>,
	formatUnitLabel: (unit: string) => string = (u) => u
): { name: string; unit: string; text: string } {
	const name = namesById.get(item.item_id) || item.item_id;
	const unit = formatUnitLabel(item.unit) || item.unit;
	return { name, unit, text: `${name} ${item.qty} ${unit}` };
}

/**
 * Item-name lookup for transfer history. Unlike the picker catalog (`toStockFormItems`), keeps
 * deactivated and merged masters — past transfers still reference them.
 */
export function transferItemNames(
	...sources: readonly (readonly { _id: string; name: string }[])[]
): Map<string, string> {
	return new Map(sources.flat().map((i) => [i._id, i.name]));
}
