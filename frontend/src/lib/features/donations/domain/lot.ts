/**
 * Lot numbering for donation drop-off verification (CR-052 §1.2, Technical Terms #4).
 *
 * A lot number names the batch of goods that came in together on one booking, in the
 * form `L-YYMMDD-XXX`: the drop-off date plus a sequence within that drop-off. It is
 * what a warehouse worker reads off the physical label to find the batch again, so the
 * date has to be the local calendar date staff see on the shelf, not UTC.
 *
 * `stock_ledger.lot` is `{expiry?, note?}` (schema.md §2.2) — there is no dedicated
 * field for a lot number, so the number travels with the storage zone inside
 * `lot.note`, the same field `receive-stock-form` already uses for the zone.
 */

/** Two-digit Buddhist-era-agnostic year + month + day of the *local* date. */
function yymmdd(date: Date): string {
	const yy = String(date.getFullYear() % 100).padStart(2, '0');
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	return `${yy}${mm}${dd}`;
}

/**
 * `L-YYMMDD-XXX` for the `seq`-th line of a drop-off received on `date`.
 *
 * `seq` is 1-based and clamped into 1–999: the format reserves three digits, and a
 * single booking never comes close to that many lines. Anything above wraps rather
 * than widening the number, which would break labels printed to a fixed width.
 */
export function generateLotNo(date: Date, seq: number): string {
	const n = ((Math.trunc(seq) - 1 + 999) % 999) + 1;
	return `L-${yymmdd(date)}-${String(n).padStart(3, '0')}`;
}

/**
 * Pack the lot number and storage zone into `stock_ledger.lot.note`.
 *
 * Zone is optional — staff may key a receipt before the goods have a shelf — and an
 * absent zone leaves just the lot number rather than a dangling separator.
 */
export function formatLotNote(lotNo: string, zone?: string): string {
	const z = zone?.trim();
	return z ? `${lotNo} · ${z}` : lotNo;
}
