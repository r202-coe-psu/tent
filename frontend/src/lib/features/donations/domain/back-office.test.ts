import { describe, expect, it } from 'vitest';
import { donationActionRef, donationRefLabel, walkInIntakeInputSchema } from './back-office';

/**
 * `booking_ref` (`DN-######`) is minted by FastAPI for PUBLIC bookings only, so a
 * donation keyed at the counter has none — while every back-office action is
 * addressed by `/api/back-office/donations/[query]/…`.
 *
 * The review screens used to reach for `booking_ref` alone and bail out when it was
 * missing, which left counter-keyed donations listed but impossible to approve,
 * reject, redirect or receive; the intake queue filtered them out entirely.
 */
describe('donationActionRef', () => {
	it('prefers the donor-facing reference staff read off the ticket', () => {
		expect(donationActionRef({ booking_ref: 'DN-123456', donation_id: 'donation:01J' })).toBe(
			'DN-123456'
		);
	});

	it('falls back to the doc id, which every donation has', () => {
		expect(donationActionRef({ donation_id: 'donation:01J' })).toBe('donation:01J');
		expect(donationActionRef({ booking_ref: '   ', donation_id: 'donation:01J' })).toBe(
			'donation:01J'
		);
	});

	it('returns null only when there is genuinely no handle', () => {
		expect(donationActionRef({})).toBeNull();
		expect(donationActionRef({ booking_ref: '', donation_id: '' })).toBeNull();
	});
});

describe('donationRefLabel', () => {
	it('shows the reference when there is one, and says why when there is not', () => {
		expect(donationRefLabel({ booking_ref: 'DN-123456' })).toBe('DN-123456');
		expect(donationRefLabel({})).toContain('เคาน์เตอร์');
	});
});

describe('walkInIntakeInputSchema', () => {
	const valid = {
		donor: { name: 'ผู้บริจาค', phone: '0800000001' },
		items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }]
	};

	it('accepts a counter donation with one catalog line', () => {
		expect(walkInIntakeInputSchema.safeParse(valid).success).toBe(true);
	});

	it('needs a donor name and at least one line', () => {
		expect(walkInIntakeInputSchema.safeParse({ ...valid, donor: { name: ' ' } }).success).toBe(
			false
		);
		expect(walkInIntakeInputSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
	});

	it('requires an item_id — a walk-in line becomes stock immediately', () => {
		const freeText = { ...valid, items: [{ free_text: 'ของเบ็ดเตล็ด', qty: '1', unit: 'ชิ้น' }] };
		expect(walkInIntakeInputSchema.safeParse(freeText).success).toBe(false);
	});

	it('refuses a formatted phone, which would hash differently every visit', () => {
		const formatted = { ...valid, donor: { name: 'ผู้บริจาค', phone: '080-000-0001' } };
		expect(walkInIntakeInputSchema.safeParse(formatted).success).toBe(false);
	});

	it('refuses a zero or negative quantity', () => {
		for (const qty of ['0', '-5']) {
			const bad = { ...valid, items: [{ item_id: 'item:rice', qty, unit: 'kg' }] };
			expect(walkInIntakeInputSchema.safeParse(bad).success).toBe(false);
		}
	});

	it('drops a client-sent lot_no — the server owns the per-day sequence (CR-088)', () => {
		const withLot = {
			...valid,
			items: [
				{
					item_id: 'item:rice',
					qty: '10',
					unit: 'kg',
					lot: { lot_no: 'L-260901-999', storage_zone: 'A-01' }
				}
			]
		};
		const parsed = walkInIntakeInputSchema.parse(withLot);
		expect(parsed.items[0].lot).toEqual({ storage_zone: 'A-01' });
	});
});
