/** Public donation ticket view — capability-URL lookup via tracking token (DN-6). */

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
};

export type DonationTrackLogistics = {
	delivery_method?: 'self_dropoff' | 'parcel' | 'shelter_pickup' | string;
	vehicle?: string | null;
	slot?: { date?: string; from?: string; to?: string } | null;
	eta?: string | null;
	courier_tracking_no?: string | null;
	pickup_address?: string | null;
};

export type DonationTrackDonor = {
	name?: string;
	phone_masked?: string;
	line_id?: string | null;
	email?: string | null;
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
	} | null;
	updated_at: string | null;
	expires_at: string | null;
	/** Donor edits so far (CR-080) — the page shows the count, not the entries. */
	revisions: Array<Record<string, unknown>>;
};

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

export function formatTrackTimestamp(
	iso: string | null | undefined,
	locale: 'th' | 'en' = 'th'
): string {
	if (!iso) return '-';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(locale === 'en' ? 'en-US' : 'th-TH', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
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

export function canCancelDonation(status: string): boolean {
	return status === 'declared' || status === 'pending_review';
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
			phone_masked: donorRaw.phone_masked != null ? String(donorRaw.phone_masked) : undefined,
			line_id: donorRaw.line_id != null ? String(donorRaw.line_id) : null,
			email: donorRaw.email != null ? String(donorRaw.email) : null
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
				category: row.category != null ? String(row.category) : null
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
		updated_at: raw.updated_at != null ? String(raw.updated_at) : null,
		expires_at: raw.expires_at != null ? String(raw.expires_at) : null,
		revisions: Array.isArray(raw.revisions) ? (raw.revisions as Array<Record<string, unknown>>) : []
	};
}
