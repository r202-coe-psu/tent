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
