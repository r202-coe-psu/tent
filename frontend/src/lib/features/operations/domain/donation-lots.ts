import { qtyGt } from '$lib/utils/qty';
import {
	projectStockLotBalances,
	StockLotIntegrityError,
	type StockLedger,
	type StockLotBalance
} from './operations';

/**
 * The lots a donation brought into stock (#821 FR-12): one row per `reason: 'donation'` ledger
 * row written on receipt, with the lot's label, expiry, place and what is left of THAT lot now.
 *
 * "What is left" is not computed here from scratch: it is the per-lot balance of
 * {@link projectStockLotBalances} — the projection the stock table uses — read back by the
 * lot's `lot_ref` (`lot_ref ?? _id` for a row from before `lot_ref`).
 */
export interface DonationLotRow {
	/** The receipt row's `_id`. */
	ledgerId: string;
	itemId: string;
	/** Quantity received into this lot. */
	qty: string;
	unit: string;
	/** `lot.lot_no`; `null` on a row from before CR-088, shown as "—". */
	lotNo: string | null;
	expiry: string | null;
	lot: StockLedger['lot'] | undefined;
	/** Quantity left in this lot; `null` when the item's history cannot be replayed. */
	remaining: string | null;
}

export function buildDonationLotRows(
	receiptRows: readonly StockLedger[],
	itemLedger: readonly StockLedger[]
): DonationLotRow[] {
	const byItem = new Map<string, StockLedger[]>();
	for (const row of itemLedger) {
		const rows = byItem.get(row.item_id);
		if (rows) rows.push(row);
		else byItem.set(row.item_id, [row]);
	}

	// One replay per item; an item whose history cannot be replayed only loses its balances.
	const balances = new Map<string, Map<string, StockLotBalance> | null>();
	const balancesOf = (itemId: string) => {
		if (!balances.has(itemId)) {
			try {
				const lots = projectStockLotBalances(byItem.get(itemId) ?? []);
				balances.set(itemId, new Map(lots.map((lot) => [lot.lot_ref, lot])));
			} catch (error) {
				if (!(error instanceof StockLotIntegrityError)) throw error;
				balances.set(itemId, null);
			}
		}
		return balances.get(itemId) ?? null;
	};

	return receiptRows
		.filter((row) => row.reason === 'donation' && qtyGt(row.qty, 0))
		.map((row) => ({
			ledgerId: row._id,
			itemId: row.item_id,
			qty: row.qty,
			unit: row.unit,
			lotNo: row.lot?.lot_no ?? null,
			expiry: row.lot?.expiry ?? null,
			lot: row.lot,
			remaining: balancesOf(row.item_id)?.get(row.lot_ref ?? row._id)?.qty ?? null
		}))
		.sort(
			(a, b) =>
				a.itemId.localeCompare(b.itemId) ||
				(a.lotNo ?? '').localeCompare(b.lotNo ?? '') ||
				a.ledgerId.localeCompare(b.ledgerId)
		);
}

/**
 * Query string of the stock page's movements tab (#811) filtered to one lot: all dates, with the
 * lot number in the free-text search (`lq` matches item, reference, destination, lot, place).
 */
export function lotHistoryQuery(lotNo: string): string {
	return new URLSearchParams({ tab: 'movements', range: 'all', lq: lotNo }).toString();
}
