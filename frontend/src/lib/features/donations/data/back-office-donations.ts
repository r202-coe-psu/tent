/**
 * Back-office donation intake queue via the SvelteKit BFF.
 *
 * `/api/back-office/donations` holds the CouchDB admin credentials and does the
 * shelter-scope check, so the browser only ever sees the redacted rows it returns
 * (`PendingDonationRow`) — same reason the public tracking calls go through the BFF.
 */
import type { DonationStatus } from '$lib/features/operations';

/** One row of the intake queue — mirrors `PendingDonationRow` on the route. */
export interface BackOfficeDonationRow {
	booking_ref?: string;
	shelter_code: string;
	status: string;
	donor_name: string;
	donor_phone: string | null;
	item_count: number;
	declared_at?: string;
	eta?: string;
	slot?: { date: string; from: string; to: string };
	delivery_method?: string;
}

/** A donation line as the scan/verify surface sees it (redacted `ScanDonationView`). */
export interface BackOfficeDonationDetail {
	booking_ref?: string;
	shelter_code: string;
	status: string;
	donor: { name: string; phone: string | null };
	items: Array<{ item_id?: string; free_text?: string; qty: string; unit: string }>;
	logistics?: {
		delivery_method?: string;
		vehicle?: string;
		slot?: { date: string; from: string; to: string };
		eta?: string;
		courier_tracking_no?: string | null;
		pickup_address?: string;
	};
}

/** What staff counted for one line, ready for `POST /api/back-office/donations/{ref}`. */
export interface CountedLineInput {
	item_id?: string;
	free_text?: string;
	qty: string;
	unit: string;
	lot?: { expiry?: string; note?: string };
}

function unwrapError(body: unknown, fallback: string): string {
	if (typeof body !== 'object' || body === null) return fallback;
	const record = body as { error?: unknown };
	return typeof record.error === 'string' ? record.error : fallback;
}

/** The intake queue for one lifecycle status — `verifying` for the drop-off tab. */
export async function fetchDonationsByStatus(
	status: DonationStatus
): Promise<BackOfficeDonationRow[]> {
	const res = await fetch(`/api/back-office/donations?status=${encodeURIComponent(status)}`);
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		if (res.status === 403)
			throw new Error('ไม่มีสิทธิ์ดูรายการรับบริจาค (ต้องเป็นเจ้าหน้าที่คลัง)');
		throw new Error(unwrapError(body, 'ไม่สามารถโหลดรายการบริจาคได้'));
	}
	return (body as { donations?: BackOfficeDonationRow[] }).donations ?? [];
}

/** Full (redacted) booking — the declared lines staff reconcile against. */
export async function fetchDonationDetail(query: string): Promise<BackOfficeDonationDetail> {
	const res = await fetch(`/api/back-office/donations/${encodeURIComponent(query)}`);
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		if (res.status === 404) throw new Error('ไม่พบข้อมูลการจองบริจาคนี้');
		throw new Error(unwrapError(body, 'ไม่สามารถโหลดรายละเอียดการจองได้'));
	}
	const donation = (body as { donation?: BackOfficeDonationDetail }).donation;
	if (!donation) throw new Error('ไม่พบข้อมูลการจองบริจาคนี้');
	return donation;
}

/**
 * Key the physical count — the route mints the `stock_ledger` rows, writes the audit
 * entry, and moves the donation to `received` (schema.md §2.3).
 */
export async function receiveDonationCount(input: {
	query: string;
	items: CountedLineInput[];
	remarks?: string;
}): Promise<void> {
	const res = await fetch(`/api/back-office/donations/${encodeURIComponent(input.query)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			status: 'received',
			...(input.remarks?.trim() ? { remarks: input.remarks.trim() } : {}),
			items: input.items
		})
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !(body as { success?: boolean }).success) {
		throw new Error(unwrapError(body, 'บันทึกรับเข้าคลังไม่สำเร็จ'));
	}
}
