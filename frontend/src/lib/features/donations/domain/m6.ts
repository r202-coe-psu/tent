import {
	closeDonationByPoints,
	hasPointReceipts,
	type DonationCloseSource
} from './point-receipts';
import type { DonationCloseReason } from '$lib/features/operations';

/**
 * Donations that come from the central warehouse (M6, `channel: "m6"`).
 *
 * An m6 donation is created only by the sync worker when a withdrawal is in transit, so it has
 * no donor, no phone and no tracking page — it is a delivery from another warehouse. After staff
 * receive it the worker confirms the receipt back to M6 and records the outcome on
 * `external.confirmed_at` / `external.confirm_error`.
 */

/** The `external` link of an m6 donation, as the back-office rows and the scan view carry it. */
export interface M6Summary {
	request_code: string;
	source_warehouse_code: string;
	source_warehouse_name: string | null;
	confirmed_at: string | null;
	confirm_error: string | null;
}

/** Structural: fits `PendingDonationRow` and `ScanDonationView` alike. */
export interface M6Carrier {
	channel?: string;
	status?: string;
	m6?: M6Summary | null;
}

export type M6ConfirmState = 'confirmed' | 'failed' | 'waiting';

/** `external` as stored on the donation doc (worker-written, so read defensively). */
interface RawExternal {
	system?: unknown;
	request_code?: unknown;
	source_warehouse_code?: unknown;
	source_warehouse_name?: unknown;
	confirmed_at?: unknown;
	confirm_error?: unknown;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** `true` for a donation that comes from the central warehouse. */
export function isM6Donation(row: { channel?: string | null }): boolean {
	return row.channel === 'm6';
}

/**
 * The summary of an m6 donation doc, or `undefined` for any other donation (including an m6
 * doc whose `external` is missing — nothing to show then, the row falls back to the donor line).
 */
export function toM6Summary(doc: {
	channel?: string | null;
	external?: RawExternal | null;
}): M6Summary | undefined {
	if (!isM6Donation(doc) || !doc.external || doc.external.system !== 'm6') return undefined;
	const ext = doc.external;
	return {
		request_code: text(ext.request_code) ?? '',
		source_warehouse_code: text(ext.source_warehouse_code) ?? '',
		source_warehouse_name: text(ext.source_warehouse_name),
		confirmed_at: text(ext.confirmed_at),
		confirm_error: text(ext.confirm_error)
	};
}

/** "คลังกลาง M6 · {คลัง}" — the warehouse name, else its code, else just "คลังกลาง M6". */
export function m6SourceLabel(row: M6Carrier): string {
	const source = row.m6?.source_warehouse_name || row.m6?.source_warehouse_code;
	return source ? `คลังกลาง M6 · ${source}` : 'คลังกลาง M6';
}

/**
 * Where the confirmation back to M6 stands. `null` for a donation that is not m6 or has not been
 * received yet (nothing to confirm); then `confirmed` once `confirmed_at` is set, `failed` while
 * the last attempt left an error (the worker retries on its own), else `waiting`.
 */
export function m6ConfirmState(row: M6Carrier): M6ConfirmState | null {
	if (!isM6Donation(row) || !row.m6 || row.status !== 'received') return null;
	if (row.m6.confirmed_at) return 'confirmed';
	if (row.m6.confirm_error) return 'failed';
	return 'waiting';
}

/** Statuses an open m6 donation can be in — anything else is already closed. */
const M6_OPEN_STATUSES = new Set(['declared', 'pending_review', 'verifying']);

/**
 * "ปิดใบ — ไม่ได้รับของ": staff may close an m6 donation on which no drop-off point has recorded
 * anything, i.e. the central warehouse sent goods that never arrived. Other channels with no
 * receipt are refused or left to expire (CR-206 FR-MP-28), never closed.
 */
export function canCloseM6WithoutGoods(
	donation: M6Carrier & { point_receipts?: readonly { line_nos: number[] }[] | null }
): boolean {
	return (
		isM6Donation(donation) &&
		M6_OPEN_STATUSES.has(donation.status ?? '') &&
		!hasPointReceipts(donation)
	);
}

export type M6CloseResult = Omit<ReturnType<typeof closeDonationByPoints>, 'status'> & {
	status: 'received';
	received_at: string;
};

/**
 * Close an m6 donation as `received`, whatever came. The worker confirms a RECEIVED donation back
 * to the central warehouse, and only then does the withdrawal leave "in transit" there — so a
 * delivery that did not arrive is closed as received with every line a shortfall (counted 0),
 * not rejected. With receipts it is `closeDonationByPoints` as usual; only the outcome "nothing
 * received" (which it reports as `rejected`) is turned into `received` here.
 */
export function closeM6Donation(
	donation: DonationCloseSource,
	opts: { closedBy: string; closedReason: DonationCloseReason; now: string }
): M6CloseResult {
	const closed = closeDonationByPoints(donation, opts);
	// `closeDonationByPoints` reports "nothing received" as a refusal; for m6 that is `received`
	// with the flag the worker reads to tell M6 "ไม่ได้รับของ" (D20).
	const nothingReceived = closed.status === 'rejected';
	return {
		status: 'received',
		received_at: opts.now,
		received_summary: nothingReceived
			? { ...closed.received_summary, total_items: 0, nothing_received: true }
			: closed.received_summary
	};
}
