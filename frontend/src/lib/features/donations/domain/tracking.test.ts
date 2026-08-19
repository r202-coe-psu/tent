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
	it('allows cancel only while the reservation still awaits drop-off', () => {
		expect(canCancelDonation('declared')).toBe(true);
	});

	it('refuses once staff took over or the booking already closed', () => {
		// Same DONOR_EDITABLE_STATUSES set both write paths gate on — the button must not
		// offer an action that DELETE would answer with 400.
		for (const status of [
			'pending_review',
			'verifying',
			'received',
			'redirected',
			'rejected',
			'expired',
			'cancelled'
		]) {
			expect(canCancelDonation(status)).toBe(false);
		}
	});
});
