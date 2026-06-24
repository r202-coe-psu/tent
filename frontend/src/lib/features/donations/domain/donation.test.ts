import { describe, it, expect } from 'vitest';
import {
    donationPreDeclarationInputSchema,
    isDonationPreDeclaration
} from './donation';

describe('donationPreDeclarationInputSchema', () => {
    // 1. Valid Case
    it('passes validation with valid donor declaration data', () => {
        const validData = {
            shelter_code: 'SH001',
            donor: {
                name: 'John Doe',
                phone: '0812345678'
            },
            items_declared: [
                { item_name: 'ข้าวสาร', qty: 10, unit: 'ชุด' },
                { item_name: 'น้ำดื่ม', qty: 5, unit: 'แพ็ค' }
            ],
            captchaToken: 'valid-token'
        };

        const result = donationPreDeclarationInputSchema.safeParse(validData);
        expect(result.success).toBe(true);
    });

    // 2. Invalid Case - Missing Shelter Code
    it('fails validation when shelter_code is missing', () => {
        const invalidData = {
            shelter_code: '',
            donor: {
                name: 'John Doe',
                phone: '0812345678'
            },
            items_declared: [
                { item_name: 'ข้าวสาร', qty: 10, unit: 'ชุด' }
            ],
            captchaToken: 'valid-token'
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
            donor: {
                name: 'John Doe',
                phone: '0812345678'
            },
            items_declared: [
                { item_name: 'ข้าวสาร', qty: -5, unit: 'ชุด' }
            ],
            captchaToken: 'valid-token'
        };

        const result = donationPreDeclarationInputSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
        if (!result.success) {
            const errorMessage = result.error.issues.find(i => i.path.includes('qty'))?.message;
            expect(errorMessage).toBe('Please enter a valid quantity')
        }
    });

    // 3.1. Invalid Case - Decimal item quantity
    it('fail validation when item quantity is decimal values', () => {
        const invalidData = {
            shelter_code: 'SH001',
            donor: {
                name: 'John Doe',
                phone: '0812345678'
            },
            items_declared: [
                { item_name: 'ข้าวสาร', qty: 10.5, unit: 'ชุด' }
            ],
            captchaToken: 'valid-token'
        };

        const result = donationPreDeclarationInputSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
        if (!result.success) {
            const errorMessage = result.error.issues.find(i => i.path.includes('qty'))?.message;
            expect(errorMessage).toBe('Please enter a valid quantity')
        }
    });

    // 4. Invalid Case - Missing donation items
    it('fails validation when donation items are missing', () => {
        const invalidData = {
            shelter_code: 'SH001',
            donor: {
                name: 'John Doe',
                phone: '0812345678'
            },
            items_declared: [],
            captchaToken: 'valid-token'
        };

        const result = donationPreDeclarationInputSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
        if (!result.success) {
            const errorMessage = result.error.issues.find(i => i.path.includes('items_declared'))?.message;
            expect(errorMessage).toBe('Please add at least one item to the donation')
        }
    });
});

describe('isDonationPreDeclaration (Type Guard)', () => {
    it('returns true for a valid donation pre-declaration document', () => {
        const mockDoc = {
            _id: 'donation_pre_declaration:some-uuid',
            type: 'donation_pre_declaration',
            tracking_token: 'some-uuid',
            shelter_code: 'SH001',
            items: [{ item_id: 'item:noodles_01', qty: 10 }],
            donor_phone_hash: 'some-sha256-hash',
            status: 'pending',
            created_at: '2026-06-19T00:00:00Z',
            created_by: 'system',
            schema_v: 1
		};

        expect(isDonationPreDeclaration(mockDoc)).toBe(true);
    });

    it('returns false for an invalid document type', () => {
        const mockDoc = {
            _id: 'evacuee:some-uuid',
            type: 'evacuee',
            first_name: 'John',
        };

        expect(isDonationPreDeclaration(mockDoc)).toBe(false);
    });
});
