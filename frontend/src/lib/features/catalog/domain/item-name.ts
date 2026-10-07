export interface NamedItem {
	_id: string;
	name: string;
}

/** ค้นหาชื่อสินค้าจาก ItemMasters หรือ SupplyItems (fallback เป็น id) */
export function getItemDisplayName(
	id?: string | null,
	itemMasters?: readonly NamedItem[] | null,
	supplyItems?: readonly NamedItem[] | null
): string {
	if (!id) return '';
	const master = itemMasters?.find((m) => m._id === id);
	if (master?.name) return master.name;
	const supply = supplyItems?.find((s) => s._id === id);
	if (supply?.name) return supply.name;
	return id;
}
