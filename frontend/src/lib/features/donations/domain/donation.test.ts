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

    // 4. Invalid Case - Missing donation items
    it('fails validation when donation items are missing', () => {
        const result = donationPreDeclarationInputSchema.safeParse({ ...baseValid, items_declared: [] });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe('Please add at least one item to the donation');
        }
    });
});

describe('isDonationPreDeclaration', () => {
    it('should return true for a valid donation_pre_declaration document', () => {
        const mockDoc = {
            _id: 'donation_pre_declaration:01ARZ3NDEKTSV4RRFFQ69G5FAV',
            type: 'donation_pre_declaration',
            schema_v: 1,
            shelter_code: 'SH001',
            tracking_token: 'token123',
            items_declared: [],
            donor_phone_hash: 'hash',
            status: 'declared',
            created_at: '2026-06-30T17:00:00Z',
            updated_at: '2026-06-30T17:00:00Z',
            created_by: 'user'
        };
        expect(isDonationPreDeclaration(mockDoc)).toBe(true);
    });

    it('should return false for invalid documents or other types', () => {
        expect(isDonationPreDeclaration({ type: 'donation' })).toBe(false);
        expect(isDonationPreDeclaration(null)).toBe(false);
        expect(isDonationPreDeclaration('string')).toBe(false);
    });
});
