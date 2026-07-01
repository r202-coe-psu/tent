import { describe, it, expect } from 'vitest';
import { donationPreDeclarationInputSchema, isDonationPreDeclaration } from './donation';

describe('donationPreDeclarationInputSchema', () => {
	const baseValid = {
		shelter_code: 'SH001',
		donor: { name: 'John Doe', phone: '0812345678' },
		items: [{ free_text: 'Rice', qty: 10, unit: 'kg' }],
		captchaToken: 'test-token'
	};

	// 1. Valid Case
	it('passes validation with valid donor declaration data', () => {
		const result = donationPreDeclarationInputSchema.safeParse(baseValid);
		expect(result.success).toBe(true);
	});

	it('fails validation when shelter_code is missing', () => {
		const result = donationPreDeclarationInputSchema.safeParse({ ...baseValid, shelter_code: '' });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe('Invalid shelter code.');
		}
	});

	// 3. Invalid Case - Negative item quantity
	it('fail validation when item quantity is zero or negative values', () => {
		const result = donationPreDeclarationInputSchema.safeParse({
			...baseValid,
			items: [{ free_text: 'Rice', qty: -5, unit: 'kg' }]
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe('Please enter a valid quantity');
		}
	});

	// 3.1. Invalid Case - Decimal item quantity
	it('fail validation when item quantity is a decimal value', () => {
		const result = donationPreDeclarationInputSchema.safeParse({
			...baseValid,
			items: [{ free_text: 'Rice', qty: 10.5, unit: 'kg' }]
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe('Please enter a valid quantity');
		}
	});

	it('fails validation when donation items are missing', () => {
		const result = donationPreDeclarationInputSchema.safeParse({
			...baseValid,
			items: []
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe('Please add at least one item to the donation');
		}
	});
});

describe('isDonationPreDeclaration (Type Guard)', () => {
	it('returns true for a valid donation pre-declaration document', () => {
		const mockDoc = {
			_id: 'donation_pre_declaration:some-uuid',
			type: 'donation_pre_declaration',
			tracking_token: 'some-uuid',
			booking_ref: 'DN-123456',
			shelter_code: 'SH001',
			items: [{ free_text: 'Noodles', qty: 10, unit: 'box' }],
			donor_phone_hash: 'some-sha256-hash',
			status: 'declared',
			created_at: '2026-06-19T00:00:00Z',
			updated_at: '2026-06-19T00:00:00Z',
			created_by: 'system',
			schema_v: 2
		};

		expect(isDonationPreDeclaration(mockDoc)).toBe(true);
	});

	it('returns false for an invalid document type', () => {
		const mockDoc = {
			_id: 'evacuee:some-uuid',
			type: 'evacuee',
			first_name: 'John'
		};

		expect(isDonationPreDeclaration(mockDoc)).toBe(false);
	});
});
