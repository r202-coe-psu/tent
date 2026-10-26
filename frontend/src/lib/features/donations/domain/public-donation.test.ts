import { describe, expect, it } from 'vitest';
import {
	donationItemEditGate,
	donationPayloadUnit,
	donorUnitOptions,
	isDonorEditable,
	linesMissingExpiry
} from './public-donation';

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

	// CR-174 FR-20 / FR-22 — a campaign booking has its QR from the start; the donor can
	// still cancel or add the courier number (the lines are fixed — CR-196).
	it('still lets the donor cancel a booking that has its QR', () => {
		expect(isDonorEditable('verifying')).toBe(true);
	});

	it('hands the count to staff once the goods are received', () => {
		expect(isDonorEditable('received')).toBe(false);
	});

	it('does not reopen a booking that already released its quota', () => {
		expect(isDonorEditable('cancelled')).toBe(false);
		expect(isDonorEditable('expired')).toBe(false);
		expect(isDonorEditable('redirected')).toBe(false);
		expect(isDonorEditable('rejected')).toBe(false);
	});
});

/** CR-196 FR-LK-4 — the lines are the donor's only until anything is decided. */
describe('donationItemEditGate', () => {
	const pending = { review_status: 'pending' as const };

	it('is open while every line still waits for review', () => {
		expect(donationItemEditGate('pending_review', [pending, pending])).toBe('editable');
		expect(donationItemEditGate('declared', [{}])).toBe('editable');
	});

	it('closes once one line is decided, by the campaign rule or by staff', () => {
		expect(donationItemEditGate('pending_review', [{ review_status: 'approved' }, pending])).toBe(
			'already_reviewed'
		);
		expect(donationItemEditGate('pending_review', [{ review_status: 'rejected' }, pending])).toBe(
			'already_reviewed'
		);
	});

	it('closes a booking with its QR, or refused, whatever its lines say', () => {
		expect(donationItemEditGate('verifying', [{}])).toBe('already_reviewed');
		expect(donationItemEditGate('rejected', [{}])).toBe('already_reviewed');
	});

	it('is closed for good once the booking is past drop-off', () => {
		for (const status of ['received', 'cancelled', 'expired', 'redirected']) {
			expect(donationItemEditGate(status, [pending])).toBe('closed');
		}
	});
});

/**
 * R-15.4 — the wizard shows a Thai unit label but the API contract wants the catalog
 * code. Sending the label made every booking from a need card unreceivable
 * (`CATALOG_MISMATCH` at the intake counter, unfixable from that screen).
 */
describe('donorUnitOptions', () => {
	it('drops nutrition and dosage units and deactivated ones, keeping the order', () => {
		const units = [
			{ code: 'piece' },
			{ code: 'kcal' },
			{ code: 'bag' },
			{ code: 'mg' },
			{ code: 'box', deactivated: true },
			{ code: 'mcg' },
			{ code: 'kg' }
		];

		expect(donorUnitOptions(units).map((u) => u.code)).toEqual(['piece', 'bag', 'kg']);
	});
});

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

/**
 * The counter form had no expiry field at all, so a perishable line could only ever
 * come back `Perishable item item:egg requires lot.expiry to be set` from the server —
 * unfixable from that screen. The rule is mirrored here so the form can name the line
 * in Thai before anything is sent.
 */
describe('linesMissingExpiry (perishable lot rule, schema.md §2.1)', () => {
	it('names the perishable lines with no expiry', () => {
		expect(
			linesMissingExpiry([
				{ item_id: 'item:egg', name: 'ไข่ไก่', perishable: true },
				{ item_id: 'item:rice', name: 'ข้าวสาร', perishable: false }
			])
		).toEqual(['ไข่ไก่']);
	});

	it('accepts a perishable line once the date is filled in', () => {
		expect(
			linesMissingExpiry([
				{ item_id: 'item:egg', name: 'ไข่ไก่', perishable: true, expiry: '2026-09-30' }
			])
		).toEqual([]);
	});

	it('treats a blank or whitespace date as missing', () => {
		for (const expiry of ['', '   ']) {
			expect(linesMissingExpiry([{ item_id: 'item:egg', perishable: true, expiry }])).toEqual([
				'item:egg'
			]);
		}
	});

	it('leaves free-text lines alone — they never reach the ledger', () => {
		expect(linesMissingExpiry([{ name: 'ของเบ็ดเตล็ด', perishable: true }])).toEqual([]);
	});

	it('falls back to the item id when the line has no display name', () => {
		expect(linesMissingExpiry([{ item_id: 'item:egg', perishable: true }])).toEqual(['item:egg']);
	});
});
