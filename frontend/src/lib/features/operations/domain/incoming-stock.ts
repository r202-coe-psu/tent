import {
	packagingMultiplier,
	qtyToBaseUnit,
	type PackagingSource
} from '$lib/features/catalog/server';
import { addQty, qtyGt } from '$lib/utils/qty';
import { bangkokToday } from '$lib/utils/date';
import type { Donation, DonationStatus, StockTransfer } from './operations';

/**
 * "Incoming stock" (#1153) — goods promised to a shelter that are not in its ledger yet:
 * approved donation lines of a booking still open, and `shipped` transfers addressed to it.
 *
 * Pure, computed at read time, never persisted. Quantities are base-unit `qty_str`, summed
 * with Decimal. Rows carry no donor PII — the endpoint serialises exactly these shapes.
 */

export type IncomingSource = 'donation' | 'transfer';

/** One line of an incoming document, already in the item's base unit. */
export interface IncomingRow {
	source: IncomingSource;
	/** `booking_ref` (donation, falls back to the doc `_id` for walk-ins) or the transfer `_id`. */
	ref: string;
	/** CouchDB `_id` of the donation / transfer — what a link to its page is built from. */
	doc_id: string;
	item_id: string;
	/** Base-unit qty_str. */
	qty: string;
	/** Asia/Bangkok calendar day `YYYY-MM-DD`; `null` when the document carries no usable date. */
	date: string | null;
	/** Donation only: the slot / ETA day is before today (Bangkok) and the booking is still open. */
	overdue: boolean;
	/** The receiving shelter. */
	shelter_code: string;
}

export type UnmatchedReason = 'free_text' | 'unknown_item' | 'unit_mismatch';

/** An approved donation line that cannot be added to a stock row (FR-5). */
export interface UnmatchedIncoming {
	source: 'donation';
	ref: string;
	doc_id: string;
	/** Donor-typed item name (`free_text`) — an item label, not donor identity. */
	label: string | null;
	/** Qty as declared, in `unit` (not converted). */
	qty: string;
	unit: string;
	date: string | null;
	overdue: boolean;
	shelter_code: string;
	reason: UnmatchedReason;
}

export interface IncomingStockResult {
	rows: IncomingRow[];
	unmatched: UnmatchedIncoming[];
}

export interface IncomingItemTotal {
	item_id: string;
	/** Sum of base-unit qty over `rows`. */
	qty: string;
	/** Earliest dated row; `null` when no row has a date. */
	earliest_date: string | null;
	/** Dated rows first (earliest first), undated last; ties by `ref`. */
	rows: IncomingRow[];
}

/** Donation statuses whose goods are not on their way any more, or already arrived (FR-1). */
export const DONATION_NOT_INCOMING_STATUSES: readonly DonationStatus[] = [
	'received',
	'rejected',
	'expired',
	'cancelled',
	'redirected'
];

export type IncomingDonationDoc = Pick<
	Donation,
	'_id' | 'kind' | 'status' | 'items' | 'booking_ref' | 'logistics' | 'point_receipts'
>;

export type IncomingTransferDoc = Pick<
	StockTransfer,
	'_id' | 'status' | 'to_shelter' | 'items' | 'timeline'
>;

/** Item lookup for unit conversion: `item_master` (or supply `item`) by `_id`. */
export type IncomingCatalog = ReadonlyMap<string, PackagingSource>;

/** The Bangkok calendar day of a `YYYY-MM-DD` or ISO timestamp; `null` when unreadable. */
function toBangkokDay(value: string | null | undefined): string | null {
	const v = value?.trim();
	if (!v) return null;
	if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
		return Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? null : v;
	}
	const ms = Date.parse(v);
	return Number.isNaN(ms) ? null : bangkokToday(new Date(ms));
}

/** `logistics.slot.date` when set, else the day of `logistics.eta` (FR-1). */
export function donationIncomingDate(donation: Pick<Donation, 'logistics'>): string | null {
	return (
		toBangkokDay(donation.logistics?.slot?.date) ?? toBangkokDay(donation.logistics?.eta ?? null)
	);
}

/**
 * Incoming rows of one donation (FR-1, FR-4, FR-5, FR-6).
 *
 * Only `review_status: 'approved'` lines of a booking not in {@link DONATION_NOT_INCOMING_STATUSES}
 * count. A line a drop-off point already recorded (`point_receipts[].line_nos`, CR-206) is in the
 * ledger, so it is left out — otherwise a part-received booking would be counted twice.
 */
export function deriveDonationIncoming(
	donation: IncomingDonationDoc,
	shelterCode: string,
	catalog: IncomingCatalog,
	now: Date = new Date()
): IncomingStockResult {
	const out: IncomingStockResult = { rows: [], unmatched: [] };
	if (donation.kind !== 'items') return out;
	if (DONATION_NOT_INCOMING_STATUSES.includes(donation.status)) return out;

	const date = donationIncomingDate(donation);
	const overdue = date !== null && date < bangkokToday(now);
	const ref = donation.booking_ref || donation._id;
	const recorded = new Set((donation.point_receipts ?? []).flatMap((r) => r.line_nos));

	(donation.items ?? []).forEach((line, index) => {
		if (line.review_status !== 'approved' || recorded.has(index)) return;
		const base = { ref, doc_id: donation._id, date, overdue, shelter_code: shelterCode };
		const unmatched = (reason: UnmatchedReason) =>
			out.unmatched.push({
				source: 'donation',
				...base,
				label: line.free_text?.trim() || null,
				qty: line.qty,
				unit: line.unit,
				reason
			});

		if (!line.item_id) return unmatched('free_text');
		const item = catalog.get(line.item_id);
		if (!item) return unmatched('unknown_item');
		if (packagingMultiplier(item, line.unit) == null) return unmatched('unit_mismatch');
		let qty: string;
		try {
			qty = qtyToBaseUnit(line.qty, line.unit, item);
		} catch {
			return unmatched('unit_mismatch');
		}
		if (!qtyGt(qty, 0)) return;
		out.rows.push({ source: 'donation', ...base, item_id: line.item_id, qty });
	});
	return out;
}

/**
 * Incoming rows of one transfer (FR-2): `shipped` only. Transfer lines are already in the base
 * unit (the API rejects any other), so `qty` is used as stored. Never overdue — no promised date.
 */
export function deriveTransferIncoming(transfer: IncomingTransferDoc): IncomingRow[] {
	if (transfer.status !== 'shipped') return [];
	const date = toBangkokDay(transfer.timeline?.shipped?.at);
	return (transfer.items ?? [])
		.filter((line) => line.item_id && qtyGt(line.qty, 0))
		.map((line) => ({
			source: 'transfer' as const,
			ref: transfer._id,
			doc_id: transfer._id,
			item_id: line.item_id,
			qty: line.qty,
			date,
			overdue: false,
			shelter_code: transfer.to_shelter
		}));
}

function compareRows(a: IncomingRow, b: IncomingRow): number {
	if (a.date !== b.date) {
		if (a.date === null) return 1;
		if (b.date === null) return -1;
		return a.date < b.date ? -1 : 1;
	}
	return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
}

/** Per-item totals (FR-7: plain sums — no netting against the ledger), ordered by `item_id`. */
export function aggregateIncoming(rows: readonly IncomingRow[]): IncomingItemTotal[] {
	const byItem = new Map<string, IncomingRow[]>();
	for (const row of rows) {
		const list = byItem.get(row.item_id);
		if (list) list.push(row);
		else byItem.set(row.item_id, [row]);
	}
	return [...byItem.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([item_id, list]) => {
			const sorted = [...list].sort(compareRows);
			return {
				item_id,
				qty: sorted.reduce((sum, r) => addQty(sum, r.qty), '0'),
				earliest_date: sorted.find((r) => r.date !== null)?.date ?? null,
				rows: sorted
			};
		});
}
