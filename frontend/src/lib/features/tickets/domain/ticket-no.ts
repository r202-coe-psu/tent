/**
 * Mints `ticket_no` — a human-readable reference label, e.g. `TKT-KITCHEN-0012`.
 * `_id` (ULID) remains the real identity; this label is cosmetic (bmad spec's own
 * note: "ticket_no ออกฝั่ง server เป็นป้ายอ้างอิงที่ collision แล้ว retry โดย _id ยังคงเป็น
 * identity"). Not atomic: two staff opening a ticket in the same instant can be
 * handed the same number — accepted, same risk CR-088 already accepted for
 * `stock_ledger.lot.lot_no` (operations.ts `nextLotNos`). Never used for balances
 * or lookups, only display.
 */
export function nextTicketNo(existing: readonly string[], requisitionType: 'kitchen'): string {
	const prefix = `TKT-${requisitionType.toUpperCase()}-`;
	let max = 0;
	for (const ticketNo of existing) {
		if (!ticketNo.startsWith(prefix)) continue;
		const seq = Number.parseInt(ticketNo.slice(prefix.length), 10);
		if (Number.isFinite(seq) && seq > max) max = seq;
	}
	return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
