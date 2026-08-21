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
		expect(canEditCourierTracking(view.status, view.logistics)).toBe(false);
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
