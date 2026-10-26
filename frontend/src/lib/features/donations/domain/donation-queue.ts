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
	{ value: 'awaiting', label: 'รอมาส่ง' }
] as const;
export type DonationQueueFilter = (typeof DONATION_QUEUE_FILTERS)[number]['value'];

/** Waiting for staff to review it, or approved and waiting for the goods. */
export function queueGroupOf(status: string): 'pending' | 'awaiting' {
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
	return filter === 'all' ? [...rows] : rows.filter((row) => queueGroupOf(row.status) === filter);
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
