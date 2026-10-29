import { describe, expect, it } from 'vitest';
import {
	canCancelDonation,
	canEditCourierTracking,
	closedAtIntakeMessage,
	donationStatusLabel,
	formatTrackSchedule,
	isTerminalDonationStatus,
	lookupItemSchedule,
	maskLookupPhone,
	rejectedLineReasons,
	toDonationTrackView,
	type DonationLookupItem
} from './tracking';

describe('toDonationTrackView', () => {
	it('maps FastAPI/BFF tracking payload into UI view', () => {
		const view = toDonationTrackView({
			status: 'declared',
			booking_ref: 'DN-123456',
			shelter_code: 'SH001',
			donor: { name: 'สมชาย', phone_masked: '***-***-5678' },
			items: [{ item_name: 'ข้าวสาร', qty: '10', unit: 'kg' }],
			logistics: {
				delivery_method: 'self_dropoff',
				vehicle: 'pickup',
				slot: { date: '2026-08-06', from: '10:00', to: '12:00' }
			},
			received_summary: null,
			updated_at: '2026-08-05T08:00:00+00:00',
			expires_at: '2026-08-08T08:00:00+00:00'
		});

		expect(view.booking_ref).toBe('DN-123456');
		expect(view.donor.name).toBe('สมชาย');
		expect(view.items[0]?.item_name).toBe('ข้าวสาร');
		expect(formatTrackSchedule(view.logistics)).toBe('2026-08-06 (10:00 - 12:00)');
		expect(donationStatusLabel(view.status)).toContain('จองคิว');
		expect(donationStatusLabel(view.status, 'en')).toBe('Donation Reserved');
		expect(canEditCourierTracking(view.status, view.logistics)).toBe(false);
	});

	it('formats labels in English and Thai properly', () => {
		expect(donationStatusLabel('received', 'th')).toBe('รับเข้าคลังเรียบร้อย');
		expect(donationStatusLabel('received', 'en')).toBe('Received into Warehouse');
		expect(donationStatusLabel('pending_review', 'en')).toBe('Pending Review');
	});

	it('allows courier edit only for open parcel donations', () => {
		expect(
			canEditCourierTracking('declared', {
				delivery_method: 'parcel',
				courier_tracking_no: null
			})
		).toBe(true);
		expect(canEditCourierTracking('received', { delivery_method: 'parcel' })).toBe(false);
	});
});

describe('canCancelDonation', () => {
	// Gates the cancel button on the donor's track page. A booking that is still only
	// a reservation may be handed back; once it is out of the donor's hands the count
	// belongs to staff.
	// `verifying` since CR-174 FR-20 — a booking with its QR can still be handed back.
	it.each(['declared', 'pending_review', 'verifying'])(
		'lets the donor cancel a %s booking',
		(status) => {
			expect(canCancelDonation(status)).toBe(true);
		}
	);

	it.each(['received', 'cancelled', 'expired', 'rejected', 'redirected'])(
		'hides cancel once the booking is %s',
		(status) => {
			expect(canCancelDonation(status)).toBe(false);
		}
	);

	it('hides cancel for an unknown status rather than guessing', () => {
		expect(canCancelDonation('')).toBe(false);
		expect(canCancelDonation('something_new')).toBe(false);
	});
});

describe('item_id survives the round trip', () => {
	/**
	 * The edit dialog sends the whole basket back. It can only send an item_id it was
	 * given, so if the view drops one the edit silently untracks that item: the counter
	 * releases what it held and never retakes it, and the needs board stops deducting it.
	 * That happened — a soap donation lost item:soap on its first edit and the public
	 * board went on advertising 50 while the back office showed 20.
	 */
	it('carries item_id from the payload', () => {
		const view = toDonationTrackView({
			status: 'declared',
			items: [{ item_id: 'item:soap', free_text: 'สบู่ก้อน', qty: '10', unit: 'bar' }]
		});
		expect(view.items[0]?.item_id).toBe('item:soap');
	});

	it('reports null rather than undefined for a free-text item', () => {
		const view = toDonationTrackView({
			status: 'declared',
			items: [{ free_text: 'ของใช้เบ็ดเตล็ด', qty: '2', unit: 'ชิ้น' }]
		});
		expect(view.items[0]?.item_id).toBeNull();
	});
});

// CR-196 FR-LK-3 — the edit dialog names each held line by its key.
describe('line_key survives the round trip', () => {
	it('carries line_key from the payload', () => {
		const view = toDonationTrackView({
			status: 'pending_review',
			items: [{ free_text: 'ผ้าห่ม', qty: '2', unit: 'ผืน', line_key: '01K8LINEKEY' }]
		});
		expect(view.items[0]?.line_key).toBe('01K8LINEKEY');
	});

	it('reports null for a line from before schema_v 8', () => {
		const view = toDonationTrackView({
			status: 'pending_review',
			items: [{ free_text: 'ผ้าห่ม', qty: '2', unit: 'ผืน' }]
		});
		expect(view.items[0]?.line_key).toBeNull();
	});
});

/**
 * "Is this booking finished with?" — one predicate for the whole tracking surface, so a
 * new terminal status cannot be forgotten by a screen that lists them by hand.
 *
 * The QR itself is NOT gated on this: CR-052 §1.4 issues the donor's check-in pass only
 * after staff approve, so the tracking page asks for `verifying` specifically.
 */
describe('isTerminalDonationStatus', () => {
	it('is false while the booking still owes the shelter goods', () => {
		for (const status of ['declared', 'pending_review', 'verifying']) {
			expect(isTerminalDonationStatus(status)).toBe(false);
		}
	});

	it('is true once nothing more will arrive', () => {
		for (const status of ['received', 'rejected', 'redirected', 'expired', 'cancelled']) {
			expect(isTerminalDonationStatus(status)).toBe(true);
		}
	});
});

describe('lookupItemSchedule', () => {
	const base: DonationLookupItem = {
		tracking_token: 'TX-SH001-ABC',
		booking_ref: 'DN-100001',
		status: 'pending_review',
		shelter_code: 'SH001',
		item_count: 1,
		created_at: '2026-10-19T10:00:00+00:00'
	};

	it('shows the booked window like the ticket does', () => {
		expect(
			lookupItemSchedule({ ...base, slot: { date: '2026-10-20', from: '09:00', to: '12:00' } })
		).toBe('2026-10-20 (09:00 - 12:00)');
	});

	it('shows a dash without a window', () => {
		expect(lookupItemSchedule({ ...base, slot: null })).toBe('-');
		expect(lookupItemSchedule({ ...base, slot: { date: null, from: null, to: null } })).toBe('-');
	});
});

describe('maskLookupPhone', () => {
	it('keeps only the last four digits', () => {
		expect(maskLookupPhone('081-234-5678')).toBe('xxx-xxx-5678');
		expect(maskLookupPhone('12')).toBe('xxx-xxx-xxxx');
	});
});

describe('reject reasons on the ticket (CR-172)', () => {
	const base = {
		status: 'received',
		shelter_code: 'SH001',
		items: [
			{ item_name: 'ข้าวสาร', qty: '10', unit: 'kg' },
			{ item_name: 'นม', qty: '2', unit: 'ลัง' }
		]
	};

	it('carries the booking reason when the shelter refused it', () => {
		const view = toDonationTrackView({
			...base,
			status: 'rejected',
			reject_reason: 'หมดอายุ — ล็อตเก่า'
		});
		expect(view.reject_reason).toBe('หมดอายุ — ล็อตเก่า');
	});

	it('FR-17: a ticket written before schema_v 6 has no reason and no rejected line', () => {
		const view = toDonationTrackView({
			...base,
			received_summary: { items: [{ item_name: 'ข้าวสาร', qty: '10' }] }
		});
		expect(view.reject_reason).toBeNull();
		expect(rejectedLineReasons(view)).toEqual([null, null]);
	});

	it('FR-16: lines up each turned-away line with the declared line it answers', () => {
		const view = toDonationTrackView({
			...base,
			received_summary: {
				items: [
					{ item_id: 'item:rice', qty: '10', unit: 'kg' },
					{ qty: '0', unit: 'ลัง', rejected: true, reject_reason: 'ชำรุดเสียหาย' }
				]
			}
		});
		expect(rejectedLineReasons(view)).toEqual([null, 'ชำรุดเสียหาย']);
	});

	it('CR-174 FR-17: carries line review and its reason from the declared items', () => {
		const view = toDonationTrackView({
			...base,
			status: 'verifying',
			items: [
				{ item_name: 'ข้าวสาร', qty: '10', unit: 'kg', review_status: 'approved' },
				{
					item_name: 'ผ้าห่ม',
					qty: '1',
					unit: 'ผืน',
					review_status: 'rejected',
					review_reason: 'หมดอายุ'
				},
				{ item_name: 'หมอน', qty: '1', unit: 'ใบ', review_status: 'rejected' }
			]
		});
		expect(view.items.map((i) => i.review_status)).toEqual(['approved', 'rejected', 'rejected']);
		expect(rejectedLineReasons(view)).toEqual([null, 'หมดอายุ', '']);
	});
});

describe('closedAtIntakeMessage', () => {
	it('lets an open booking through to the count', () => {
		for (const status of ['declared', 'pending_review', 'verifying']) {
			expect(closedAtIntakeMessage('DN-1', status)).toBeNull();
		}
	});

	it('names the booking and its status, and points a closed one to walk-in', () => {
		expect(closedAtIntakeMessage('DN-1', 'cancelled')).toBe(
			'ใบจอง DN-1 ยกเลิกการจองแล้ว — รับเข้าคลังไม่ได้ ถ้าของอยู่ที่เคาน์เตอร์จริงให้กรอกข้อมูลใหม่ผ่าน "ลงทะเบียน Walk-in"'
		);
		for (const status of ['rejected', 'redirected', 'expired']) {
			expect(closedAtIntakeMessage('DN-1', status)).toContain('Walk-in');
		}
	});

	it('does not offer walk-in for goods already received', () => {
		expect(closedAtIntakeMessage('DN-1', 'received')).toBe(
			'ใบจอง DN-1 รับเข้าคลังเรียบร้อย — รับซ้ำไม่ได้'
		);
	});
});
