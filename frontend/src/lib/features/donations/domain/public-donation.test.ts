import { describe, expect, it } from 'vitest';
import { donationPayloadUnit, isDonorEditable } from './public-donation';

/**
 * D-1 — CR-052 §1.4 opens every public booking in `pending_review` instead of
 * `declared`, so the donor's own edit/cancel has to reach that status; leaving it out
 * would silently take the feature away from every booking the wizard creates.
 *
 * Mirrored by `DONOR_EDITABLE_STATUSES` in the FastAPI donations use case.
 */
describe('isDonorEditable (T-21 / CR-080 / D-1)', () => {
	it('lets the donor edit a booking still awaiting drop-off', () => {
		expect(isDonorEditable('declared')).toBe(true);
		expect(isDonorEditable('pending_review')).toBe(true);
	});

	it('hands the count to staff once the goods are being checked in', () => {
		expect(isDonorEditable('verifying')).toBe(false);
		expect(isDonorEditable('received')).toBe(false);
	});

	it('does not reopen a booking that already released its quota', () => {
		expect(isDonorEditable('cancelled')).toBe(false);
		expect(isDonorEditable('expired')).toBe(false);
		expect(isDonorEditable('redirected')).toBe(false);
		expect(isDonorEditable('rejected')).toBe(false);
	});
});

/**
 * R-15.4 — the wizard shows a Thai unit label but the API contract wants the catalog
 * code. Sending the label made every booking from a need card unreceivable
 * (`CATALOG_MISMATCH` at the intake counter, unfixable from that screen).
 */
describe('donationPayloadUnit (R-15.4)', () => {
	it('sends the catalog code, not the label the donor was shown', () => {
		expect(donationPayloadUnit({ unit_code: 'kg', unit: 'กก.' }, 'ชิ้น')).toBe('kg');
		expect(donationPayloadUnit({ unit_code: 'bar', unit: 'ก้อน' }, 'ชิ้น')).toBe('bar');
	});

	it('falls back to the typed unit for a free-text line with no catalog item', () => {
		expect(donationPayloadUnit({ unit: 'ลัง' }, 'ชิ้น')).toBe('ลัง');
	});

	it('uses the fallback when neither is usable', () => {
		expect(donationPayloadUnit({}, 'ชิ้น')).toBe('ชิ้น');
		expect(donationPayloadUnit({ unit: '   ' }, 'ชิ้น')).toBe('ชิ้น');
		expect(donationPayloadUnit({ unit_code: '  ', unit: 'ลัง' }, 'ชิ้น')).toBe('ลัง');
	});
});
