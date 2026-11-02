/** Back-office booking queue via the SvelteKit BFF (`/api/back-office/donations`). */
import type { PendingDonationRow } from '../domain/back-office';
import { DONATION_QUEUE_STATUSES, mergeQueueResponses } from '../domain/donation-queue';
import type { ReceivedSearchBy } from '../domain/received-search';

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
				? RECEIVED_INDEX_UNAVAILABLE_MESSAGE
				: data.error || 'โหลดรายการที่รับแล้วไม่สำเร็จ'
		);
	}
	return {
		donations: (data.donations ?? []) as PendingDonationRow[],
		bookmark: data.has_more ? (data.bookmark ?? null) : null,
		hasMore: Boolean(data.has_more)
	};
}

/** Text shown when a database has no index / view for the "รับแล้ว" list or its search yet. */
export const RECEIVED_INDEX_UNAVAILABLE_MESSAGE =
	'ยังไม่พร้อมแสดงรายการที่รับแล้ว (ฐานข้อมูลของศูนย์ยังไม่มีดัชนี) กรุณาติดต่อผู้ดูแลระบบ';

export type ReceivedSearchPage = {
	donations: PendingDonationRow[];
	/** Pass back as `cursor` for the next page; `null` at the end. */
	cursor: string | null;
	hasMore: boolean;
};

/** What staff are told for each way a search is refused (FR-8). */
function receivedSearchErrorMessage(data: { error?: string; error_code?: string }): string {
	if (data.error_code === 'INVALID_PHONE') return 'เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0';
	if (data.error_code === 'INVALID_LOT') return 'เลขล็อตต้องเป็นรูปแบบ L-YYMMDD-XXX';
	if (data.error === 'DONATION_INDEX_UNAVAILABLE') return RECEIVED_INDEX_UNAVAILABLE_MESSAGE;
	return data.error || 'ค้นหารายการที่รับแล้วไม่สำเร็จ';
}

/**
 * Search the received donations of a whole shelter on the server (#821 FR-8): one type at a
 * time, an exact match. The term goes in the body, not the URL. The rows are masked, like the
 * list's; `cursor` is the server's opaque handle for the next page.
 */
export async function searchReceivedDonations(input: {
	shelterCode: string;
	by: ReceivedSearchBy;
	q: string;
	cursor?: string | null;
}): Promise<ReceivedSearchPage> {
	const res = await fetch('/api/back-office/donations/received/search', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			...(input.shelterCode ? { shelter_code: input.shelterCode } : {}),
			by: input.by,
			q: input.q,
			...(input.cursor ? { cursor: input.cursor } : {})
		})
	});
	const data = await res.json().catch(() => ({ success: false }));
	if (!res.ok || !data.success) throw new Error(receivedSearchErrorMessage(data));
	return {
		donations: (data.donations ?? []) as PendingDonationRow[],
		cursor: data.has_more ? (data.cursor ?? null) : null,
		hasMore: Boolean(data.has_more)
	};
}

/** The donor contact in full, as `POST …/contact` returns it (FR-10a). Each field may be gone. */
export type DonorContact = {
	name: string | null;
	phone: string | null;
	email: string | null;
};

/**
 * Ask for the donor's full contact (FR-10a). Every call is audited server-side, so this runs
 * only when staff press "แสดงข้อมูลติดต่อ" — never on render, never prefetched.
 */
export async function fetchDonorContact(ref: string): Promise<DonorContact> {
	const res = await fetch(`/api/back-office/donations/${encodeURIComponent(ref)}/contact`, {
		method: 'POST'
	});
	const data = await res.json().catch(() => ({ success: false }));
	if (!res.ok || !data.success) {
		throw new Error(
			res.status === 503
				? 'ยังบันทึกการเปิดดูข้อมูลไม่ได้ จึงไม่แสดงข้อมูลติดต่อ กรุณาลองใหม่'
				: res.status === 403
					? 'ไม่มีสิทธิ์ดูข้อมูลติดต่อของรายการนี้'
					: data.error || 'โหลดข้อมูลติดต่อไม่สำเร็จ'
		);
	}
	const contact = (data.contact ?? {}) as Partial<DonorContact>;
	return {
		name: contact.name ?? null,
		phone: contact.phone ?? null,
		email: contact.email ?? null
	};
}
