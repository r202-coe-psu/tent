import { describe, it, expect } from 'vitest';
import {
    donationPreDeclarationInputSchema
} from './donation';

describe('donationPreDeclarationInputSchema', () => {
    const baseValid = {
        shelter_code: 'SH001',
        donor: { name: 'John Doe', phone: '0812345678' },
        items_declared: [{ item_name: 'Rice', qty: 10, unit: 'kg' }],
        captchaToken: 'test-token'
    };

    // 1. Valid Case
    it('passes validation with valid donor declaration data', () => {
        const result = donationPreDeclarationInputSchema.safeParse(baseValid);
        expect(result.success).toBe(true);
    });

    // 2. Invalid Case - Missing Shelter Code
    it('fails validation when shelter_code is missing', () => {
        const result = donationPreDeclarationInputSchema.safeParse({ ...baseValid, shelter_code: '' });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe('Please select a shelter.');
        }
    });

    // 3. Invalid Case - Negative item quantity
    it('fail validation when item quantity is zero or negative values', () => {
        const result = donationPreDeclarationInputSchema.safeParse({
            ...baseValid,
            items_declared: [{ item_name: 'Rice', qty: -5, unit: 'kg' }]
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
            items_declared: [{ item_name: 'Rice', qty: 10.5, unit: 'kg' }]
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
