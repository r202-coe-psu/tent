/** Back-office booking queue via the SvelteKit BFF (`/api/back-office/donations`). */
import type { PendingDonationRow } from '../domain/back-office';
import { DONATION_QUEUE_STATUSES, mergeQueueResponses } from '../domain/donation-queue';

/**
 * One request per status the list shows. A failure throws rather than returning an
 * empty list: an empty queue and a refused request used to look identical.
 */
export async function fetchDonationQueue(): Promise<PendingDonationRow[]> {
	const responses = await Promise.all(
		DONATION_QUEUE_STATUSES.map(async (status) => {
			const res = await fetch(`/api/back-office/donations?status=${status}`);
			const data = await res.json().catch(() => ({ success: false }));
			if (!res.ok || !data.success) {
				throw new Error(data.error || `โหลดรายการสถานะ ${status} ไม่สำเร็จ`);
			}
			return (data.donations ?? []) as PendingDonationRow[];
		})
	);
	return mergeQueueResponses(responses);
}

export type ReceivedDonationsPage = {
	donations: PendingDonationRow[];
	/** Pass back as `bookmark` for the next page; `null` once the end was reached. */
	bookmark: string | null;
	hasMore: boolean;
};

/**
 * One page of received donations for a shelter (#821), newest first. Separate from
 * {@link fetchDonationQueue}: "ทั้งหมด" never asks for `received`. The server pages with a
 * CouchDB bookmark; a changing dataset has no snapshot guarantee, so a refresh restarts at
 * the first page (no bookmark).
 */
export async function fetchReceivedDonationsPage(
	shelterCode: string,
	bookmark: string | null = null
): Promise<ReceivedDonationsPage> {
	const params = new URLSearchParams({ status: 'received' });
	if (shelterCode) params.set('shelter', shelterCode);
	if (bookmark) params.set('bookmark', bookmark);
	const res = await fetch(`/api/back-office/donations?${params}`);
	const data = await res.json().catch(() => ({ success: false }));
	if (!res.ok || !data.success) {
		throw new Error(
			data.error === 'DONATION_INDEX_UNAVAILABLE'
				? 'ยังไม่พร้อมแสดงรายการที่รับแล้ว (ฐานข้อมูลของศูนย์ยังไม่มีดัชนี) กรุณาติดต่อผู้ดูแลระบบ'
				: data.error || 'โหลดรายการที่รับแล้วไม่สำเร็จ'
		);
	}
	return {
		donations: (data.donations ?? []) as PendingDonationRow[],
		bookmark: data.has_more ? (data.bookmark ?? null) : null,
		hasMore: Boolean(data.has_more)
	};
}
