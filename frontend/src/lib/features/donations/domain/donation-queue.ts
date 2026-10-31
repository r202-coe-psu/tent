import { donationActionRef, type PendingDonationRow } from './back-office';

/**
 * The one back-office list of bookings (#617): what waits for review and what waits to
 * be dropped off, side by side, instead of a review tab and a scan tab showing the same
 * rows twice.
 */
export const DONATION_QUEUE_STATUSES = ['pending_review', 'verifying', 'declared'] as const;

export const DONATION_QUEUE_FILTERS = [
	{ value: 'all', label: 'ทั้งหมด' },
	{ value: 'pending', label: 'รอประเมิน' },
	{ value: 'awaiting', label: 'รอมาส่ง' },
	{ value: 'received', label: 'รับแล้ว' }
] as const;
export type DonationQueueFilter = (typeof DONATION_QUEUE_FILTERS)[number]['value'];

/** Statuses `GET /api/back-office/donations?status=` accepts (#821). Anything else is a 400. */
export const DONATION_STATUS_ALLOWLIST = [...DONATION_QUEUE_STATUSES, 'received'] as const;

export function isAllowedDonationStatus(value: string): boolean {
	return (DONATION_STATUS_ALLOWLIST as readonly string[]).includes(value);
}

/** Rows per "รับแล้ว" page. Fixed server-side — a client-sent limit is ignored. */
export const RECEIVED_PAGE_SIZE = 20;
export const RECEIVED_BOOKMARK_MAX_LENGTH = 1024;

/** Mango index the "รับแล้ว" list reads from (`DONATION_RECEIVED_MANGO_INDEX`). */
export const DONATION_RECEIVED_INDEX = {
	ddoc: '_design/donation-received-list',
	name: 'donation-received-by-received-at'
} as const;

/**
 * `_find` body for one page of received donations, newest first. Bounded on purpose:
 * `allow_fallback: false` makes CouchDB fail (no_usable_index) instead of scanning the
 * database, and the cursor is the bookmark, never `skip`.
 */
export function buildReceivedFindBody(bookmark?: string | null) {
	return {
		selector: { type: 'donation', status: 'received' },
		sort: [{ type: 'desc' }, { status: 'desc' }, { received_at: 'desc' }, { _id: 'desc' }],
		use_index: [DONATION_RECEIVED_INDEX.ddoc, DONATION_RECEIVED_INDEX.name],
		allow_fallback: false,
		limit: RECEIVED_PAGE_SIZE,
		...(bookmark ? { bookmark } : {})
	};
}

/** Waiting for staff to review it, approved and waiting for the goods, or already received. */
export function queueGroupOf(status: string): 'pending' | 'awaiting' | 'received' {
	if (status === 'received') return 'received';
	return status === 'pending_review' ? 'pending' : 'awaiting';
}

export function parseQueueFilter(value: string | null | undefined): DonationQueueFilter {
	return DONATION_QUEUE_FILTERS.some((f) => f.value === value)
		? (value as DonationQueueFilter)
		: 'all';
}

/**
 * The old `?tab=scan` / `?tab=pending` links (bookmarks, other screens) land on the list
 * with the filter that matches what the old tab showed.
 */
export function filterForLegacyTab(tab: string | null | undefined): DonationQueueFilter | null {
	if (tab === 'scan') return 'awaiting';
	if (tab === 'pending') return 'pending';
	return null;
}

export function filterDonationQueue<T extends { status: string }>(
	rows: readonly T[],
	filter: DonationQueueFilter
): T[] {
	// "ทั้งหมด" is the open queue only: a received donation is never part of it (#821).
	return filter === 'all'
		? rows.filter((row) => row.status !== 'received')
		: rows.filter((row) => queueGroupOf(row.status) === filter);
}

/**
 * One row per booking, keyed on whatever addresses it — a walk-in has no `booking_ref`,
 * and keying on that alone dropped every counter-keyed booking.
 */
export function mergeQueueResponses(
	responses: readonly PendingDonationRow[][]
): PendingDonationRow[] {
	const seen = new Set<string>();
	const rows: PendingDonationRow[] = [];
	for (const row of responses.flat()) {
		const ref = donationActionRef(row);
		if (!ref || seen.has(ref)) continue;
		seen.add(ref);
		rows.push(row);
	}
	return rows;
}
