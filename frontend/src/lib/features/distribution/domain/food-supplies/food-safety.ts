/**
 * Ready-meal safety window at the distribution desk (draft-onsite-distribution FR-MQW-06,
 * decided B on 2026-10-10): the clock is the `lot.expiry` of the stock lot the dispatch
 * `distribute` ledger row drew for the ticket item (via `stock_ledger.lot_ref`). No ticket
 * schema change. Expired food may still be handed over; the log is stamped
 * `is_expired_warning: true`.
 */

export interface LotExpiryStatus {
	/** ISO expiry of the dispatched lot. */
	expiry: string;
	isExpired: boolean;
	/** Whole minutes until expiry, 0 once expired. */
	minutesLeft: number;
}

/** Expiry status of a lot at `now`; `null` when the lot has no usable expiry. */
export function lotExpiryStatus(
	expiry: string | null | undefined,
	now: number = Date.now()
): LotExpiryStatus | null {
	if (!expiry) return null;
	const at = new Date(expiry).getTime();
	if (Number.isNaN(at)) return null;
	const msLeft = at - now;
	return {
		expiry,
		isExpired: msLeft <= 0,
		minutesLeft: msLeft > 0 ? Math.floor(msLeft / 60_000) : 0
	};
}

/** True when the lot expiry is known and already passed at `now`. */
export function isLotExpired(expiry: string | null | undefined, now: number = Date.now()): boolean {
	return lotExpiryStatus(expiry, now)?.isExpired ?? false;
}
