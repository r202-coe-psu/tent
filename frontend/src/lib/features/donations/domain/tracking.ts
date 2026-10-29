/** Public donation ticket view — capability-URL lookup via tracking token (DN-6). */

import type { components } from '$lib/api/openapi';
import { formatThaiDateTime } from '$lib/utils/date';

export type DonationTrackStatus =
	| 'declared'
	| 'pending_review'
	| 'verifying'
	| 'received'
	| 'redirected'
	| 'rejected'
	| 'expired'
	| 'cancelled'
	| string;

export type DonationTrackItem = {
	/**
	 * Kept even though nothing renders it. The edit form sends the basket back whole,
	 * and a line that returns without its item_id stops being quota-tracked.
	 */
	item_id: string | null;
	item_name: string;
	qty: string | number | null;
	unit: string | null;
	category?: string | null;
	/** The line's identity (CR-196) — the edit form sends it back. Absent before schema_v 8. */
	line_key: string | null;
	/** Per-line review (CR-174 FR-17) — absent on bookings before schema_v 7. */
	review_status?: 'approved' | 'pending' | 'rejected' | null;
	review_reason?: string | null;
	/** Where the donor takes this line (CR-206 FR-MP-1) — `null` = no point. */
	drop_off_point_id?: string | null;
};

/** What a point recorded, as the donor may see it (CR-206 §Change) — no staff or stock ids. */
export type DonationTrackPointReceipt = {
	point_id: string | null;
	line_nos: number[];
	received_at: string | null;
};

export type DonationTrackLogistics = {
	delivery_method?: 'self_dropoff' | 'parcel' | 'shelter_pickup' | string;
	vehicle?: string | null;
	slot?: { date?: string; from?: string; to?: string } | null;
	eta?: string | null;
	courier_tracking_no?: string | null;
	pickup_address?: string | null;
};

/** What the tracking API sends of the donor (CR-209 FR-4b allowlist): no contact beyond this. */
export type DonationTrackDonor = {
	name?: string;
	phone_masked?: string;
};

export type DonationTrackView = {
	status: DonationTrackStatus;
	booking_ref: string | null;
	shelter_code: string;
	donor: DonationTrackDonor;
	items: DonationTrackItem[];
	logistics: DonationTrackLogistics | null;
	received_summary: {
		total_items?: number;
		received_at?: string;
		remarks?: string;
		shortfalls?: Array<{
			item_id?: string;
			item_name?: string;
			declared?: string;
			counted?: string;
			short?: string;
		}>;
		items?: Array<{
			item_id?: string;
			free_text?: string;
			item_name?: string;
			qty?: string | number;
			unit?: string;
			/** Turned away at the counter, with the reason the donor reads (CR-172 FR-14). */
			rejected?: boolean;
			reject_reason?: string;
			reject_reason_code?: string;
		}>;
	} | null;
	/** Why the shelter refused the booking — absent on docs before schema_v 6 (FR-17). */
	reject_reason: string | null;
	updated_at: string | null;
	expires_at: string | null;
	/** Donor edits so far (CR-080) — the page shows the count, not the entries. */
	revisions: Array<Record<string, unknown>>;
	/** Receipts at drop-off points (CR-206 FR-MP-5) — `[]` until a point records one. */
	point_receipts: DonationTrackPointReceipt[];
};

/** One booking of a phone number, as `lookup-by-phone` lists it (CR-173 FR-4). */
export type DonationLookupItem = components['schemas']['DonationPhoneLookupItem'];

/** When the donor is due — the booked window, in the ticket's own format. */
export function lookupItemSchedule(item: DonationLookupItem, locale: 'th' | 'en' = 'th'): string {
	const slot = item.slot;
	return formatTrackSchedule(
		{
			delivery_method: item.delivery_method ?? undefined,
			slot: slot
				? {
						date: slot.date ?? undefined,
						from: slot.from ?? undefined,
						to: slot.to ?? undefined
					}
				: null
		},
		locale
	);
}

/** `xxx-xxx-1234` — the number shown back to whoever typed it, not echoed in full. */
export function maskLookupPhone(phone: string): string {
	const digits = phone.replace(/\D/g, '');
	return digits.length < 4 ? 'xxx-xxx-xxxx' : `xxx-xxx-${digits.slice(-4)}`;
}

const STATUS_LABELS: Record<string, { th: string; en: string }> = {
	declared: { th: 'จองคิวบริจาคแล้ว', en: 'Donation Reserved' },
	pending_review: { th: 'รอตรวจสอบความเหมาะสม', en: 'Pending Review' },
	verifying: { th: 'กำลังตรวจรับที่ศูนย์', en: 'Checking in at Shelter' },
	received: { th: 'รับเข้าคลังเรียบร้อย', en: 'Received into Warehouse' },
	redirected: { th: 'ส่งต่อไปศูนย์อื่น', en: 'Redirected to Other Shelter' },
	rejected: { th: 'ไม่รับรายการนี้', en: 'Rejected' },
	expired: { th: 'หมดอายุการจอง', en: 'Reservation Expired' },
	cancelled: { th: 'ยกเลิกการจองแล้ว', en: 'Reservation Cancelled' }
};

const DELIVERY_LABELS: Record<string, { th: string; en: string }> = {
	self_dropoff: { th: 'นำมาส่งเอง', en: 'Self Drop-off' },
	parcel: { th: 'ส่งพัสดุ', en: 'Parcel / Courier' },
	shelter_pickup: { th: 'ให้รถศูนย์ไปรับ', en: 'Shelter Pickup' }
};

const VEHICLE_LABELS: Record<string, { th: string; en: string }> = {
	motorcycle: { th: 'รถจักรยานยนต์', en: 'Motorcycle' },
	car: { th: 'รถยนต์', en: 'Car / Sedan' },
	pickup: { th: 'รถกระบะ', en: 'Pickup Truck' },
	truck: { th: 'รถบรรทุก', en: 'Truck' }
};

export function donationStatusLabel(status: string, locale: 'th' | 'en' = 'th'): string {
	return STATUS_LABELS[status]?.[locale] ?? STATUS_LABELS[status]?.th ?? status;
}

export function deliveryMethodLabel(
	method: string | undefined | null,
	locale: 'th' | 'en' = 'th'
): string {
	if (!method) return '-';
	return DELIVERY_LABELS[method]?.[locale] ?? DELIVERY_LABELS[method]?.th ?? method;
}

export function vehicleLabel(
	vehicle: string | undefined | null,
	locale: 'th' | 'en' = 'th'
): string {
	if (!vehicle) return '-';
	return VEHICLE_LABELS[vehicle]?.[locale] ?? VEHICLE_LABELS[vehicle]?.th ?? vehicle;
}

/**
 * Display timestamp for donation tracking. Always th-TH + Asia/Bangkok;
 * `locale` is kept for call-site compatibility and is not used for dates.
 */
export function formatTrackTimestamp(
	iso: string | null | undefined,
	_locale?: 'th' | 'en'
): string {
	void _locale;
	if (!iso) return '-';
	const formatted = formatThaiDateTime(iso);
	return formatted || iso;
}

export function formatTrackSchedule(
	logistics: DonationTrackLogistics | null,
	locale: 'th' | 'en' = 'th'
): string {
	if (!logistics) return '-';
	const slot = logistics.slot;
	if (slot?.date) {
		const range =
			slot.from && slot.to ? ` (${slot.from} - ${slot.to})` : slot.from ? ` (${slot.from})` : '';
		return `${slot.date}${range}`;
	}
	if (logistics.eta) return formatTrackTimestamp(logistics.eta, locale);
	return '-';
}

/** Same set as `isDonorEditable` — `verifying` too since CR-174 (FR-20). */
export function canCancelDonation(status: string): boolean {
	return status === 'declared' || status === 'pending_review' || status === 'verifying';
}

export function canEditCourierTracking(
	status: string,
	logistics: DonationTrackLogistics | null
): boolean {
	if (!logistics || logistics.delivery_method !== 'parcel') return false;
	return status === 'declared' || status === 'pending_review' || status === 'verifying';
}

export function isTerminalDonationStatus(status: string): boolean {
	return (
		status === 'received' ||
		status === 'cancelled' ||
		status === 'expired' ||
		status === 'rejected' ||
		status === 'redirected'
	);
}

function stringOrNull(value: unknown): string | null | undefined {
	if (value === null) return null;
	return typeof value === 'string' ? value : undefined;
}

/**
 * The `logistics` the public tracking API may return (CR-209 FR-4): only these keys, from
 * CouchDB and the FastAPI fallback alike. Anything else on the doc — `vehicle_plate` is donor
 * PII — never reaches the tracking page.
 */
export function toTrackingLogistics(raw: unknown): DonationTrackLogistics | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const out: DonationTrackLogistics = {};
	if (typeof src.delivery_method === 'string') out.delivery_method = src.delivery_method;
	for (const key of ['vehicle', 'eta', 'courier_tracking_no', 'pickup_address'] as const) {
		const value = stringOrNull(src[key]);
		if (value !== undefined) out[key] = value;
	}
	if (src.slot === null) {
		out.slot = null;
	} else if (src.slot && typeof src.slot === 'object') {
		const slot = src.slot as Record<string, unknown>;
		out.slot = {};
		for (const key of ['date', 'from', 'to'] as const) {
			const value = slot[key];
			if (typeof value === 'string') out.slot[key] = value;
		}
	}
	return out;
}

/**
 * The `received_summary` the public tracking API may return: the whole result the tracking
 * page reads (CR-172 line results, shortfalls, CR-206 `closed_reason`), minus `closed_by` —
 * the name of the staff member who closed the booking (decision sync 2026-10-30).
 */
export function toTrackingReceivedSummary(raw: unknown): Record<string, unknown> | null {
	if (!raw || typeof raw !== 'object') return null;
	const summary = { ...(raw as Record<string, unknown>) };
	delete summary.closed_by;
	return summary;
}

/** `***-***-1234` — the form FastAPI's tracking payload already uses (`_mask_phone`). */
function maskTrackingPhone(phone: string): string {
	const digits = phone.replace(/\D/g, '');
	return digits.length < 4 ? '***' : `***-***-${digits.slice(-4)}`;
}

/**
 * The `donor` the public tracking API may return: the name and a masked phone, nothing else.
 * The CouchDB doc carries the full `phone`, `phone_hash`, `line_id` and `email`; the tracking
 * page shows only the name and `phone_masked`, so the rest never leaves the server.
 */
export function toTrackingDonor(raw: unknown): DonationTrackDonor {
	if (!raw || typeof raw !== 'object') return {};
	const src = raw as Record<string, unknown>;
	const out: DonationTrackDonor = {};
	if (typeof src.name === 'string') out.name = src.name;
	if (typeof src.phone_masked === 'string') out.phone_masked = src.phone_masked;
	else if (typeof src.phone === 'string' && src.phone)
		out.phone_masked = maskTrackingPhone(src.phone);
	return out;
}

/**
 * Why the counter cannot open this booking, or `null` when it can. The receive route
 * refuses every terminal status; saying so at lookup spares staff a full count that
 * only fails on confirm. A received booking gets no walk-in hint — keying the same
 * goods again would count them twice.
 */
export function closedAtIntakeMessage(bookingRef: string, status: string): string | null {
	if (!isTerminalDonationStatus(status)) return null;
	const head = `ใบจอง ${bookingRef} ${donationStatusLabel(status)}`;
	if (status === 'received') return `${head} — รับซ้ำไม่ได้`;
	return `${head} — รับเข้าคลังไม่ได้ ถ้าของอยู่ที่เคาน์เตอร์จริงให้กรอกข้อมูลใหม่ผ่าน "ลงทะเบียน Walk-in"`;
}

/** Normalize BFF / FastAPI tracking payload into a stable UI view. */
export function toDonationTrackView(raw: Record<string, unknown>): DonationTrackView {
	const donorRaw = (raw.donor ?? {}) as Record<string, unknown>;
	const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
	const logisticsRaw = raw.logistics;
	const receivedRaw = raw.received_summary;

	return {
		status: String(raw.status ?? 'declared'),
		booking_ref: raw.booking_ref != null ? String(raw.booking_ref) : null,
		shelter_code: String(raw.shelter_code ?? ''),
		donor: {
			name: donorRaw.name != null ? String(donorRaw.name) : undefined,
			phone_masked: donorRaw.phone_masked != null ? String(donorRaw.phone_masked) : undefined
		},
		items: itemsRaw.map((item) => {
			const row = item as Record<string, unknown>;
			return {
				// Carried even though nothing on the page displays it. The edit dialog sends
				// the basket back whole, and an item that returns without its item_id stops
				// being quota-tracked: no counter, no deduction from the needs board, and
				// whatever it held is released and never retaken.
				item_id: row.item_id != null ? String(row.item_id) : null,
				item_name: String(row.item_name ?? row.free_text ?? 'ของบริจาค'),
				qty: (row.qty as string | number | null) ?? null,
				unit: row.unit != null ? String(row.unit) : null,
				category: row.category != null ? String(row.category) : null,
				line_key: typeof row.line_key === 'string' && row.line_key ? row.line_key : null,
				review_status:
					row.review_status === 'approved' ||
					row.review_status === 'pending' ||
					row.review_status === 'rejected'
						? row.review_status
						: null,
				review_reason: typeof row.review_reason === 'string' ? row.review_reason : null,
				drop_off_point_id:
					typeof row.drop_off_point_id === 'string' && row.drop_off_point_id
						? row.drop_off_point_id
						: null
			};
		}),
		logistics:
			logisticsRaw && typeof logisticsRaw === 'object'
				? (logisticsRaw as DonationTrackLogistics)
				: null,
		received_summary:
			receivedRaw && typeof receivedRaw === 'object'
				? (receivedRaw as DonationTrackView['received_summary'])
				: null,
		reject_reason:
			typeof raw.reject_reason === 'string' && raw.reject_reason.trim() ? raw.reject_reason : null,
		updated_at: raw.updated_at != null ? String(raw.updated_at) : null,
		expires_at: raw.expires_at != null ? String(raw.expires_at) : null,
		revisions: Array.isArray(raw.revisions)
			? (raw.revisions as Array<Record<string, unknown>>)
			: [],
		point_receipts: toTrackPointReceipts(raw.point_receipts)
	};
}

function toTrackPointReceipts(raw: unknown): DonationTrackPointReceipt[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((entry) => {
		if (!entry || typeof entry !== 'object') return [];
		const row = entry as Record<string, unknown>;
		const lineNos = Array.isArray(row.line_nos)
			? row.line_nos.filter((n): n is number => Number.isInteger(n))
			: [];
		return [
			{
				point_id: typeof row.point_id === 'string' && row.point_id ? row.point_id : null,
				line_nos: lineNos,
				received_at: typeof row.received_at === 'string' ? row.received_at : null
			}
		];
	});
}

/**
 * The donor may no longer cancel or edit once a point recorded a receipt (CR-206 FR-MP-17):
 * the BFF answers 409 GOODS_IN_STOCK, so the page says so before the donor tries.
 */
export function isStartedAtPoint(view: Pick<DonationTrackView, 'point_receipts'>): boolean {
	return view.point_receipts.length > 0;
}

/**
 * Why each declared line was turned away, by position in `items` — `null` for a line
 * that was not, `''` for one refused without a reason of its own (the whole booking
 * was, and the booking reason says why). Staff refuse a line either at review
 * (CR-174 `review_status`) or at the counter (CR-172 `received_summary.items[]`, one
 * counted line per declared line, in order).
 */
export function rejectedLineReasons(view: DonationTrackView): (string | null)[] {
	const counted = view.received_summary?.items ?? [];
	return view.items.map((item, index) => {
		// The review's reason first: it is what the donor was told when the line was refused.
		if (item.review_status === 'rejected') return item.review_reason?.trim() ?? '';
		const line = counted[index];
		if (line?.rejected) return line.reject_reason?.trim() ?? '';
		return null;
	});
}
