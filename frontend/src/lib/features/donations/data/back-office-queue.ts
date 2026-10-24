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
