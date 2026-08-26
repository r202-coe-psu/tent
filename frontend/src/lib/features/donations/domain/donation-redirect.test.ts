import { describe, it, expect } from 'vitest';
import {
	createDonationRedirect,
	donationRedirectInputSchema,
	isDonationRedirect
} from './donation-redirect';

const ctx = { shelterCode: 'SH002', createdBy: 'staff01' };

describe('donationRedirectInputSchema (CR-087)', () => {
	it('requires a destination shelter code', () => {
		expect(donationRedirectInputSchema.safeParse({}).success).toBe(false);
		expect(donationRedirectInputSchema.safeParse({ target_shelter_code: '  ' }).success).toBe(
			false
		);
		expect(donationRedirectInputSchema.safeParse({ target_shelter_code: 'SH002' }).success).toBe(
			true
		);
	});

	it('caps the note at 500 characters', () => {
		const long = 'ก'.repeat(501);
		expect(
			donationRedirectInputSchema.safeParse({ target_shelter_code: 'SH002', note: long }).success
		).toBe(false);
	});
});

describe('createDonationRedirect (CR-087)', () => {
	const base = {
		origin_shelter_code: 'SH001',
		origin_donation_id: 'donation:123',
		booking_ref: 'DN-999999',
		donor: { name: 'John Donor', phone: '0812345678' },
		items: [{ item_id: 'item:rice', qty: '10', unit: 'kg' }],
		note: 'ศูนย์เต็ม'
	};

	it('stamps the DESTINATION shelter on the envelope and keeps the origin in its own field', () => {
		const doc = createDonationRedirect(base, ctx);
		expect(doc.shelter_code).toBe('SH002'); // the db this doc is written into
		expect(doc.origin_shelter_code).toBe('SH001');
		expect(doc.origin_donation_id).toBe('donation:123');
		expect(doc._id.startsWith('donation_redirect:')).toBe(true);
		expect(doc.schema_v).toBe(1);
	});

	it('always starts the destination at pending_review, never inheriting the origin state', () => {
		expect(createDonationRedirect(base, ctx).status).toBe('pending_review');
	});

	it('carries only the donor fields the destination needs (data minimization)', () => {
		const doc = createDonationRedirect(
			{
				...base,
				donor: {
					name: 'John Donor',
					phone: null
				}
			},
			ctx
		);
		expect(doc.donor).toEqual({ name: 'John Donor', phone: null });
		expect(Object.keys(doc.donor)).toEqual(['name', 'phone']);
	});

	it('normalises an empty note and a missing booking ref to null', () => {
		const doc = createDonationRedirect({ ...base, booking_ref: undefined, note: '   ' }, ctx);
		expect(doc.booking_ref).toBeNull();
		expect(doc.note).toBeNull();
	});

	it('round-trips through the persisted-doc guard', () => {
		const doc = createDonationRedirect(base, ctx);
		expect(isDonationRedirect(doc)).toBe(true);
		expect(isDonationRedirect({ ...doc, status: 'received' })).toBe(false);
		expect(isDonationRedirect({ ...doc, origin_donation_id: 'nope' })).toBe(false);
	});
});
