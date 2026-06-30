import { describe, it, expect } from 'vitest';
import {
	donationPreDeclarationInputSchema,
	isDonationPreDeclaration,
	receiveDonation,
	type DonationPreDeclaration
} from './donation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeclaredDonation(overrides: Partial<DonationPreDeclaration> = {}): DonationPreDeclaration {
	return {
		_id: 'donation_pre_declaration:01ABCDEFGHIJKLMNOPQRSTUVWX',
		type: 'donation_pre_declaration',
		schema_v: 2,
		shelter_code: 'SH001',
		tracking_token: 'tok-abc',
		booking_ref: 'DN-123456',
		items: [
			{ free_text: 'Noodles', qty: 10, unit: 'box' },
			{ free_text: 'Water', qty: 5, unit: 'bottle' }
		],
		donor_phone_hash: 'sha256-hash',
		status: 'declared',
		created_at: '2026-06-01T00:00:00.000Z',
		updated_at: '2026-06-01T00:00:00.000Z',
		created_by: 'public',
		...overrides
	};
}

// ---------------------------------------------------------------------------
// donationPreDeclarationInputSchema
// ---------------------------------------------------------------------------

describe('donationPreDeclarationInputSchema', () => {
	const getValidData = () => ({
		shelter_code: 'SH001',
		donor: { name: 'John Doe', phone: '0812345678' },
		items: [
			{ free_text: 'Noodles', qty: 10, unit: 'box' },
			{ free_text: 'Water', qty: 5, unit: 'bottle' }
		],
		captchaToken: 'valid_token'
	});

	it('passes validation with valid donor declaration data', () => {
		const result = donationPreDeclarationInputSchema.safeParse(getValidData());
		expect(result.success).toBe(true);
	});

    // 2. Invalid Case - Missing Shelter Code
    it('fails validation when shelter_code is missing', () => {
        const invalidData = {
            shelter_code: '',
            items: [{ item_id: 'item:noodles_01', qty: 10 }],
            phone: '0812345678',
            otpToken: '123456'
        };

        const result = donationPreDeclarationInputSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
        if (!result.success) {
            const errorMessage = result.error.issues.find(i => i.path.includes('shelter_code'))?.message;
            expect(errorMessage).toBe('Please select a shelter.')
        }
    });

    // 3. Invalid Case - Invalid donation quantity: negative or decimal values.
    it('fail validation when item quantity is zero or negative values', () => {
        const invalidData = {
            shelter_code: 'SH001',
            items: [{ item_id: 'item:noodles_01', qty: -5 }],
            phone: '0812345678',
            otpToken: '123456'
        };

        const result = donationPreDeclarationInputSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
        if (!result.success) {
            const errorMessage = result.error.issues.find(i => i.path.includes('qty') || i.path.includes('items'))?.message;
            expect(errorMessage).toBe('Please enter a valid quantity')
        }
    });

    // 3.1. Invalid Case - Decimal item quantity
    it('fail validation when item quantity is zero or negative values', () => {
        const invalidData = {
            shelter_code: 'SH001',
            items: [{ item_id: 'item:noodles_01', qty: 10.5 }],
            phone: '0812345678',
            otpToken: '123456'
        };

        const result = donationPreDeclarationInputSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
        if (!result.success) {
            const errorMessage = result.error.issues.find(i => i.path.includes('qty') || i.path.includes('items'))?.message;
            expect(errorMessage).toBe('Please enter a valid quantity')
        }
    });

    // 4. Invalid Case - Missing donation items
    it('fails validation when donation items are missing', () => {
        const invalidData = {
            shelter_code: 'SH001',
            items: [],
            phone: '0812345678',
            otpToken: '123456'
        };

        const result = donationPreDeclarationInputSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
        if (!result.success) {
            const errorMessage = result.error.issues.find(i => i.path.includes('items'))?.message;
            expect(errorMessage).toBe('Please add at least one item to the donation')
        }
    });
});

describe('isDonationPreDeclaration (Type Guard)', () => {
	it('returns true for a valid donation pre-declaration document', () => {
		expect(isDonationPreDeclaration(makeDeclaredDonation())).toBe(true);
	});

	it('returns false for an invalid document type', () => {
		expect(isDonationPreDeclaration({ _id: 'evacuee:01', type: 'evacuee', first_name: 'John' })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// receiveDonation — T-16-3.2 Audit Trail
// ---------------------------------------------------------------------------

