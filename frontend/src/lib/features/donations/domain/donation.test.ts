import { describe, it, expect } from 'vitest';
import {
	donationPreDeclarationInputSchema,
	donorCategoryFromCatalog,
	isDonationPreDeclaration,
	PUBLIC_DONATION_CATEGORIES
} from './donation';
import { publicDonationErrorMessage, receiveDonationInputSchema } from './public-donation';

describe('donationPreDeclarationInputSchema', () => {
	const baseValid = {
		shelter_code: 'SH001',
		donor: { name: 'John Doe', phone: '0812345678' },
		items: [{ free_text: 'Rice', qty: 10, unit: 'kg' }],
		// logistics เป็น req เมื่อ channel=public (schema.md §2.3)
		logistics: { delivery_method: 'self_dropoff', vehicle: 'car' },
		captchaToken: 'test-token'
	};

	it('fails validation when logistics is missing (required for public)', () => {
		const noLogistics = { ...baseValid };
		delete (noLogistics as Partial<typeof baseValid>).logistics;
		const result = donationPreDeclarationInputSchema.safeParse(noLogistics);
		expect(result.success).toBe(false);
	});

	it('fails validation when vehicle is set on a parcel delivery', () => {
		const result = donationPreDeclarationInputSchema.safeParse({
			...baseValid,
			logistics: { delivery_method: 'parcel', vehicle: 'car' }
		});
		expect(result.success).toBe(false);
	});

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
	});

	// 3.1. Decimal item quantity is accepted as qty_str (CR-038)
	it('accepts decimal item quantity as qty_str', () => {
		const result = donationPreDeclarationInputSchema.safeParse({
			...baseValid,
			items: [{ free_text: 'Rice', qty: 10.5, unit: 'kg' }]
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.items[0].qty).toBe('10.5');
		}
	});

	// 4. Invalid Case - Missing donation items
	it('fails validation when donation items are missing', () => {
		const result = donationPreDeclarationInputSchema.safeParse({ ...baseValid, items: [] });
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
			schema_v: 2,
			shelter_code: 'SH001',
			tracking_token: 'token123',
			items: [],
			donor_phone_hash: 'hash',
			status: 'declared',
			created_at: '2026-06-30T17:00:00Z',
			updated_at: '2026-06-30T17:00:00Z',
			created_by: 'user'
		};
		expect(isDonationPreDeclaration(mockDoc)).toBe(true);
	});

	it('should return false for invalid documents or other types', () => {
		expect(isDonationPreDeclaration(null)).toBe(false);
		expect(isDonationPreDeclaration('string')).toBe(false);
	});

	it('should return false for donation type documents even with items', () => {
		expect(
			isDonationPreDeclaration({
				_id: 'donation:01ARZ3NDEKTSV4RRFFQ69G5FAV',
				type: 'donation',
				schema_v: 2,
				shelter_code: 'SH001',
				items: [{ item_id: 'item:rice', qty: 10, unit: 'kg' }],
				status: 'declared',
				created_at: '2026-06-30T17:00:00Z',
				updated_at: '2026-06-30T17:00:00Z',
				created_by: 'user'
			})
		).toBe(false);
	});
});

describe('publicDonationErrorMessage', () => {
	it('maps known API error codes to Thai copy', () => {
		expect(publicDonationErrorMessage('NEED_FULL')).toContain('ครบแล้ว');
		expect(publicDonationErrorMessage('SLOT_FULL')).toContain('คิวจัดส่งเต็ม');
	});

	it('falls back for unknown codes', () => {
		expect(publicDonationErrorMessage('UNKNOWN')).toContain('ไม่สามารถจองคิวบริจาคได้');
	});
});

describe('receiveDonationInputSchema', () => {
	it('accepts received status with optional items', () => {
		const result = receiveDonationInputSchema.safeParse({
			status: 'received',
			items: [{ free_text: 'ข้าวสาร', qty: 1, unit: 'kg' }]
		});
		expect(result.success).toBe(true);
	});

	it('rejects non-received status values', () => {
		const result = receiveDonationInputSchema.safeParse({ status: 'cancelled' });
		expect(result.success).toBe(false);
	});
});

/**
 * The needs card used to copy the catalog category straight into the booking, with
 * `|| 'food'` behind it — and the public needs API never sent one at all, so EVERY
 * item booked from the board was filed as food. A donation for `item:blanket` with
 * `category: "food"` is what showed up in CouchDB.
 */
describe('donorCategoryFromCatalog', () => {
	it('folds the catalog split back into what the donor form offers', () => {
		expect(donorCategoryFromCatalog('food')).toBe('food');
		expect(donorCategoryFromCatalog('water')).toBe('food');
		expect(donorCategoryFromCatalog('bedding')).toBe('clothing');
		expect(donorCategoryFromCatalog('clothing')).toBe('clothing');
		expect(donorCategoryFromCatalog('medicine')).toBe('medicine');
		expect(donorCategoryFromCatalog('hygiene')).toBe('supply');
		expect(donorCategoryFromCatalog('equipment')).toBe('supply');
		expect(donorCategoryFromCatalog('other')).toBe('other');
	});

	it('only ever returns a value the form can actually show', () => {
		const allowed = PUBLIC_DONATION_CATEGORIES.map((c) => c.value as string);
		for (const catalog of [
			'food',
			'water',
			'clothing',
			'bedding',
			'medicine',
			'hygiene',
			'equipment',
			'other'
		]) {
			expect(allowed).toContain(donorCategoryFromCatalog(catalog));
		}
	});

	it('says nothing rather than guessing when the category is missing or unknown', () => {
		expect(donorCategoryFromCatalog(undefined)).toBeUndefined();
		expect(donorCategoryFromCatalog(null)).toBeUndefined();
		expect(donorCategoryFromCatalog('')).toBeUndefined();
		expect(donorCategoryFromCatalog('ของแปลก')).toBeUndefined();
	});

	it('tolerates case and padding from hand-maintained catalog rows', () => {
		expect(donorCategoryFromCatalog(' Bedding ')).toBe('clothing');
	});
});
