import { addQty, qtyGt } from '$lib/utils/qty';
import { DISPLAY_TIME_ZONE, bangkokToday } from '$lib/utils/date';
import {
	canCarrySelfPurchased,
	projectLotsByItem,
	type StockLedger,
	type StockLotBalance
} from './operations';

/**
 * Self-purchased lots (schema_v 7, CR-234).
 *
 * A lot is "ซื้อเอง" when the row that created it says so. The identity is the physical lot
 * (`lot_ref`, or the row's own `_id` for a lot's first row), so a `distribution_return` into that
 * lot stays self-purchased, while a `transfer_in` never is — the flag is never carried across
 * shelters. Rows from before schema_v 7 have no flag and are not self-purchased.
 */

/** A flagged manual receipt (adjust/found, qty > 0) — the only kind of row that makes a lot self-purchased. */
export function isSelfPurchasedReceipt(
	entry: Pick<StockLedger, 'reason' | 'adjust_reason' | 'qty' | 'lot'>
): boolean {
	return (
		entry.lot?.self_purchased === true &&
		qtyGt(entry.qty, 0) &&
		canCarrySelfPurchased(entry.reason, entry.adjust_reason)
	);
}

/** `lot_ref`s of every lot whose creating row is a flagged receipt. */
export function selfPurchasedLotRefs(ledger: readonly StockLedger[]): Set<string> {
	const refs = new Set<string>();
	for (const entry of ledger) {
		if (isSelfPurchasedReceipt(entry)) refs.add(entry.lot_ref ?? entry._id);
	}
	return refs;
}

export function isSelfPurchasedLot(lotRef: string, refs: ReadonlySet<string>): boolean {
	return refs.has(lotRef);
}

/** Remaining (qty > 0) self-purchased lots among `lots`. */
export function selfPurchasedBalances(
	lots: readonly StockLotBalance[],
	refs: ReadonlySet<string>
): StockLotBalance[] {
	return lots.filter((lot) => qtyGt(lot.qty, 0) && refs.has(lot.lot_ref));
}

/** Inclusive Asia/Bangkok calendar days, `YYYY-MM-DD`. */
export interface SelfPurchasedRange {
	from: string;
	to: string;
}

/** First of the current Bangkok month through today. */
export function defaultSelfPurchasedRange(now: Date = new Date()): SelfPurchasedRange {
	const today = bangkokToday(now);
	return { from: `${today.slice(0, 8)}01`, to: today };
}

export interface SelfPurchasedSummaryRow {
	item_id: string;
	unit: string;
	/** Self-purchased qty received in the range. */
	receivedQty: string;
	/** Qty still on hand in self-purchased lots (all time, lots above zero only). */
	onHandQty: string;
}

export interface SelfPurchasedSummary {
	rows: SelfPurchasedSummaryRow[];
	/** Items whose history cannot be replayed per lot — their on-hand is left out. */
	brokenItemIds: string[];
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
	timeZone: DISPLAY_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/** Bangkok day of an ISO instant; `null` when it is not a valid date. */
function bangkokDay(iso: string): string | null {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : dayFormat.format(date);
}

/**
 * Per-item self-purchased summary of one shelter's ledger: what was bought in the range
 * (by the receipt's `occurred_at`, Bangkok days, both ends inclusive) and what is left of
 * the self-purchased lots now. `now` only picks the default range.
 */
export function summarizeSelfPurchased(
	ledger: readonly StockLedger[],
	range: SelfPurchasedRange | undefined,
	now: Date = new Date()
): SelfPurchasedSummary {
	const resolved = range ?? defaultSelfPurchasedRange(now);
	const [from, to] =
		resolved.from > resolved.to ? [resolved.to, resolved.from] : [resolved.from, resolved.to];
	const refs = selfPurchasedLotRefs(ledger);
	const byItem = new Map<string, SelfPurchasedSummaryRow>();
	const rowFor = (itemId: string, unit: string) => {
		const key = `${itemId}\u0000${unit}`;
		let r = byItem.get(key);
		if (!r) {
			r = { item_id: itemId, unit, receivedQty: '0', onHandQty: '0' };
			byItem.set(key, r);
		}
		return r;
	};

	for (const entry of ledger) {
		if (!isSelfPurchasedReceipt(entry)) continue;
		const day = bangkokDay(entry.occurred_at);
		if (day === null || day < from || day > to) continue;
		const r = rowFor(entry.item_id, entry.unit);
		r.receivedQty = addQty(r.receivedQty, entry.qty);
	}

	const { lots, brokenItemIds } = projectLotsByItem(ledger);
	for (const lot of selfPurchasedBalances(lots, refs)) {
		const r = rowFor(lot.item_id, lot.unit);
		r.onHandQty = addQty(r.onHandQty, lot.qty);
	}

	const rows = [...byItem.values()]
		.filter((r) => qtyGt(r.receivedQty, 0) || qtyGt(r.onHandQty, 0))
		.sort((a, b) => a.item_id.localeCompare(b.item_id, 'th') || a.unit.localeCompare(b.unit));
	return { rows, brokenItemIds };
}
