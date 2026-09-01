import { describe, expect, it } from 'vitest';
import {
	canCancelDonation,
	canEditCourierTracking,
	donationStatusLabel,
	formatTrackSchedule,
	toDonationTrackView
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
	it.each(['declared', 'pending_review'])('lets the donor cancel a %s booking', (status) => {
		expect(canCancelDonation(status)).toBe(true);
	});

	it.each(['received', 'verifying', 'cancelled', 'expired', 'rejected', 'redirected'])(
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
