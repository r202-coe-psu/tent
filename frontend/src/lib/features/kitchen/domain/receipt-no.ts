/**
 * Mints `meal_service.receipt_no` (CR-177) — a human-readable reference label,
 * e.g. `RCV-KITCHEN-0001`. `_id` (ULID) remains the real identity; this label is
 * display-only. Not atomic: two staff recording a service in the same instant can
 * be handed the same number — accepted, same risk as `nextTicketNo`. Legacy docs
 * without `receipt_no` (and other prefixes / malformed suffixes) are ignored.
 */
export const RECEIPT_NO_PREFIX = 'RCV-KITCHEN-';

export function nextReceiptNo(existing: readonly (string | undefined)[]): string {
	let max = 0;
	for (const receiptNo of existing) {
		if (!receiptNo || !receiptNo.startsWith(RECEIPT_NO_PREFIX)) continue;
		const suffix = receiptNo.slice(RECEIPT_NO_PREFIX.length);
		if (!/^\d+$/.test(suffix)) continue;
		const seq = Number.parseInt(suffix, 10);
		if (Number.isFinite(seq) && seq > max) max = seq;
	}
	return `${RECEIPT_NO_PREFIX}${String(max + 1).padStart(4, '0')}`;
}

/** Label shown to users: `receipt_no` when present, else the legacy `_id`-derived code. */
export function mealServiceRef(service: { _id: string; receipt_no?: string }): string {
	return service.receipt_no || `RCV-${service._id.slice(-6).toUpperCase()}`;
}
