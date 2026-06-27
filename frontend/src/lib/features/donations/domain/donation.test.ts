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

	it('fails validation when shelter_code is missing', () => {
		const result = donationPreDeclarationInputSchema.safeParse({ ...getValidData(), shelter_code: '' });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe('Please select a shelter.');
		}
	});

	it('fails validation when item quantity is zero or negative', () => {
		const result = donationPreDeclarationInputSchema.safeParse({
			...getValidData(),
			items: [{ free_text: 'Rice', qty: -5, unit: 'kg' }]
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe('Please enter a valid quantity');
		}
	});

	it('fails validation when item quantity is decimal', () => {
		const result = donationPreDeclarationInputSchema.safeParse({
			...getValidData(),
			items: [{ free_text: 'Rice', qty: 10.5, unit: 'kg' }]
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe('Please enter a valid quantity');
		}
	});

	it('fails validation when donation items are missing', () => {
		const result = donationPreDeclarationInputSchema.safeParse({ ...getValidData(), items: [] });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe('Please add at least one item to the donation');
		}
	});
});

// ---------------------------------------------------------------------------
// isDonationPreDeclaration
// ---------------------------------------------------------------------------

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

describe('receiveDonation', () => {
	const intakeInput = {
		reason: 'ผู้บริจาคนำมาส่งเองที่ศูนย์',
		staff_name: 'นายสมชาย ใจดี'
	};

	it('transitions donation status from declared → received', () => {
		const declared = makeDeclaredDonation();
		const { donation } = receiveDonation(declared, intakeInput);
		expect(donation.status).toBe('received');
	});

	it('does not mutate the original donation document (pure function)', () => {
		const declared = makeDeclaredDonation();
		receiveDonation(declared, intakeInput);
		expect(declared.status).toBe('declared');
	});

	it('bumps updated_at on the returned donation', () => {
		const declared = makeDeclaredDonation();
		const { donation } = receiveDonation(declared, intakeInput);
		// updated_at must be ≥ original (it's refreshed by touch())
		expect(new Date(donation.updated_at).getTime()).toBeGreaterThanOrEqual(
			new Date(declared.updated_at).getTime()
		);
	});

	it('creates an audit doc with type "audit"', () => {
		const { audit } = receiveDonation(makeDeclaredDonation(), intakeInput);
		expect(audit.type).toBe('audit');
	});

	it('audit _id starts with "audit:"', () => {
		const { audit } = receiveDonation(makeDeclaredDonation(), intakeInput);
		expect(audit._id.startsWith('audit:')).toBe(true);
	});

	it('audit action defaults to manual_adjust', () => {
		const { audit } = receiveDonation(makeDeclaredDonation(), intakeInput);
		expect(audit.action).toBe('manual_adjust');
	});

	it('audit action is retro_edit when specified', () => {
		const { audit } = receiveDonation(makeDeclaredDonation(), {
			...intakeInput,
			action: 'retro_edit'
		});
		expect(audit.action).toBe('retro_edit');
	});

	it('audit target_type is "donation"', () => {
		const { audit } = receiveDonation(makeDeclaredDonation(), intakeInput);
		expect(audit.target_type).toBe('donation');
	});

	it('audit target_id matches the donation _id', () => {
		const declared = makeDeclaredDonation();
		const { audit } = receiveDonation(declared, intakeInput);
		expect(audit.target_id).toBe(declared._id);
	});

	it('audit reason matches input', () => {
		const { audit } = receiveDonation(makeDeclaredDonation(), intakeInput);
		expect(audit.reason).toBe(intakeInput.reason);
	});

	it('audit context contains staff_name', () => {
		const { audit } = receiveDonation(makeDeclaredDonation(), intakeInput);
		expect(audit.context?.staff_name).toBe(intakeInput.staff_name);
	});

	it('audit context contains booking_ref from the donation', () => {
		const declared = makeDeclaredDonation({ booking_ref: 'DN-999' });
		const { audit } = receiveDonation(declared, intakeInput);
		expect(audit.context?.booking_ref).toBe('DN-999');
	});

	it('audit context item_count matches donation items length', () => {
		const declared = makeDeclaredDonation();
		const { audit } = receiveDonation(declared, intakeInput);
		expect(audit.context?.item_count).toBe(declared.items.length);
	});

	it('audit shelter_code matches the donation shelter_code', () => {
		const { audit } = receiveDonation(makeDeclaredDonation(), intakeInput);
		expect(audit.shelter_code).toBe('SH001');
	});

	it('throws when donation is already received', () => {
		const received = makeDeclaredDonation({ status: 'received' });
		expect(() => receiveDonation(received, intakeInput)).toThrow(
			/Cannot receive donation with status "received"/
		);
	});

	it('throws when donation is expired', () => {
		const expired = makeDeclaredDonation({ status: 'expired' });
		expect(() => receiveDonation(expired, intakeInput)).toThrow(
			/Cannot receive donation with status "expired"/
		);
	});
});
