/** Back-office booking queue via the SvelteKit BFF (`/api/back-office/donations`). */
import type { PendingDonationRow } from '../domain/back-office';
import { DONATION_QUEUE_STATUSES, mergeQueueResponses } from '../domain/donation-queue';

/**
 * One request per status the list shows, for the shelter being worked in. `shelterCode` goes to
 * the server as `?shelter_code=` and is checked against the caller's warehouse capability there
 * (#477); `null` = no shelter chosen (a system admin sees every shelter). A failure throws rather
 * than returning an empty list: an empty queue and a refused request used to look identical.
 */
export async function fetchDonationQueue(
	shelterCode: string | null
): Promise<PendingDonationRow[]> {
	const responses = await Promise.all(
		DONATION_QUEUE_STATUSES.map(async (status) => {
			const qs = new URLSearchParams({ status });
			if (shelterCode) qs.set('shelter_code', shelterCode);
			const res = await fetch(`/api/back-office/donations?${qs}`);
			const data = await res.json().catch(() => ({ success: false }));
			if (!res.ok || !data.success) {
				throw new Error(data.error || `โหลดรายการสถานะ ${status} ไม่สำเร็จ`);
			}
			return (data.donations ?? []) as PendingDonationRow[];
		})
	);
	return mergeQueueResponses(responses);
}
