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
};

const STATUS_LABELS: Record<string, string> = {
	declared: 'จองคิวบริจาคแล้ว',
	pending_review: 'รอตรวจสอบความเหมาะสม',
	verifying: 'กำลังตรวจรับที่ศูนย์',
	received: 'รับเข้าคลังเรียบร้อย',
	redirected: 'ส่งต่อไปศูนย์อื่น',
	rejected: 'ไม่รับรายการนี้',
	expired: 'หมดอายุการจอง',
	cancelled: 'ยกเลิกการจองแล้ว'
};

const DELIVERY_LABELS: Record<string, string> = {
	self_dropoff: 'นำมาส่งเอง',
	parcel: 'ส่งพัสดุ',
	shelter_pickup: 'ให้รถศูนย์ไปรับ'
};

const VEHICLE_LABELS: Record<string, string> = {
	motorcycle: 'รถจักรยานยนต์',
	car: 'รถยนต์',
	pickup: 'รถกระบะ',
	truck: 'รถบรรทุก'
};

export function donationStatusLabel(status: string): string {
	return STATUS_LABELS[status] ?? status;
}

export function deliveryMethodLabel(method: string | undefined | null): string {
	if (!method) return '-';
	return DELIVERY_LABELS[method] ?? method;
}

export function vehicleLabel(vehicle: string | undefined | null): string {
	if (!vehicle) return '-';
	return VEHICLE_LABELS[vehicle] ?? vehicle;
}

export function formatTrackTimestamp(iso: string | null | undefined): string {
	if (!iso) return '-';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString('th-TH', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
}

export function formatTrackSchedule(logistics: DonationTrackLogistics | null): string {
	if (!logistics) return '-';
	const slot = logistics.slot;
	if (slot?.date) {
		const range =
			slot.from && slot.to ? ` (${slot.from} - ${slot.to})` : slot.from ? ` (${slot.from})` : '';
		return `${slot.date}${range}`;
	}
	if (logistics.eta) return formatTrackTimestamp(logistics.eta);
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
		expires_at: raw.expires_at != null ? String(raw.expires_at) : null
	};
}
