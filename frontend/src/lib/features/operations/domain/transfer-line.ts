import { toLedgerQtyUnit, type PackagingSource } from '$lib/features/catalog';

/**
 * A transfer line as the server stores it: the transfer doc feeds `transfer_out` /
 * `transfer_in` ledger rows, so qty and unit are always in the item's base unit
 * (schema.md §2.1) — the same rule `validateTransferUnits` enforces on create.
 */
export interface TransferLine {
	item_id: string;
	qty: string;
	unit: string;
}

/**
 * Convert a line typed in a packaging UOM (e.g. "2 bag") to the item's base unit
 * ("10 kg"). Throws when the unit is neither the base nor a packaging UOM of the item.
 */
export function toTransferLine(
	item: PackagingSource,
	line: { item_id: string; qty: string; unit: string }
): TransferLine {
	const { qty, unit } = toLedgerQtyUnit(line.qty, line.unit, item);
	return { item_id: line.item_id, qty, unit };
}
